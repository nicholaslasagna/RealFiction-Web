package com.realfiction.realcore.economy;

import com.realfiction.realcore.config.GameplayEconomyProducerConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import java.lang.reflect.Method;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.plugin.Plugin;

/**
 * Captures EconomyShopGUI sell {@code PostTransactionEvent} instances via reflection so
 * RealCore does not require a compile-time dependency on EconomyShopGUI-API.
 */
public final class EconomyShopGuiSellProducer implements GameplayEconomyProducer, Listener {
  public static final String ID = "economyShopGuiSell";
  public static final String SOURCE = "EconomyShopGUI";

  private static final String EVENT_CLASS = "me.gypopo.economyshopgui.api.events.PostTransactionEvent";
  private final Plugin plugin;
  private final RealCoreConfig config;
  private final GameplayEconomyProducerConfig producerConfig;
  private final GameplayEconomyCaptureService captureService;
  private final GameplayEconomyProducerMetrics metrics;
  private final Logger logger;

  private volatile boolean running;
  private volatile String hookStatus = "not started";

  public EconomyShopGuiSellProducer(
      Plugin plugin,
      RealCoreConfig config,
      GameplayEconomyCaptureService captureService,
      Logger logger
  ) {
    this.plugin = Objects.requireNonNull(plugin, "plugin");
    this.config = Objects.requireNonNull(config, "config");
    this.producerConfig = config.economy().gameplaySync().producers().economyShopGuiSell();
    this.captureService = Objects.requireNonNull(captureService, "captureService");
    this.metrics = captureService.metrics();
    this.logger = logger == null ? Logger.getLogger("RealCore") : logger;
  }

  @Override
  public String id() {
    return ID;
  }

  @Override
  public void start() {
    stop();
    if (!producerConfig.enabled()) {
      hookStatus = "disabled by config";
      return;
    }
    if (captureService.guardReason(producerConfig) != null) {
      hookStatus = "guarded: " + captureService.guardReason(producerConfig);
      return;
    }
    if (!isEconomyShopGuiPresent()) {
      hookStatus = "EconomyShopGUI not installed";
      return;
    }
    try {
      Class<? extends Event> eventClass = eventClass();
      Bukkit.getPluginManager().registerEvent(
          eventClass,
          this,
          EventPriority.MONITOR,
          (listener, event) -> handlePostTransaction(event),
          plugin,
          false
      );
      running = true;
      hookStatus = "listening for PostTransactionEvent (SELL)";
      logger.info("Gameplay sync EconomyShopGUI sell producer registered.");
    } catch (ClassNotFoundException error) {
      hookStatus = "PostTransactionEvent class not found";
      logger.log(Level.WARNING, "EconomyShopGUI API classes unavailable; sell producer inactive.", error);
    } catch (RuntimeException error) {
      hookStatus = "registration failed: " + error.getMessage();
      logger.log(Level.WARNING, "EconomyShopGUI sell producer registration failed.", error);
    }
  }

  @Override
  public void stop() {
    running = false;
    if (!"not started".equals(hookStatus)) {
      HandlerList.unregisterAll(this);
    }
    hookStatus = "stopped";
  }

  @Override
  public boolean running() {
    return running;
  }

  @Override
  public GameplayEconomyProducerMetrics metrics() {
    return metrics;
  }

  @Override
  public String statusSummary() {
    return hookStatus;
  }

  void handlePostTransaction(Object event) {
    if (!running || event == null) {
      return;
    }
    try {
      if (!isSellTransaction(event) || !isSuccessfulTransaction(event)) {
        return;
      }
      Player player = (Player) invoke(event, "getPlayer");
      if (player == null) {
        return;
      }
      long amountMinor = resolveVaultAmountMinor(event);
      if (amountMinor <= 0) {
        return;
      }
      String eventId = buildEventId(event, player.getUniqueId(), amountMinor);
      captureService.capture(new GameplayEconomyCaptureService.CaptureRequest(
          ID,
          producerConfig,
          player.getUniqueId(),
          player.getName(),
          amountMinor,
          SOURCE,
          eventId,
          "EconomyShopGUI sell"
      ));
    } catch (ReflectiveOperationException | RuntimeException error) {
      logger.log(Level.FINE, "EconomyShopGUI sell capture skipped", error);
    }
  }

  private boolean isEconomyShopGuiPresent() {
    return Bukkit.getPluginManager().getPlugin("EconomyShopGUI") != null
        || Bukkit.getPluginManager().getPlugin("EconomyShopGUI-Premium") != null;
  }

  @SuppressWarnings("unchecked")
  private static Class<? extends Event> eventClass() throws ClassNotFoundException {
    return (Class<? extends Event>) Class.forName(EVENT_CLASS);
  }

  private static boolean isSellTransaction(Object event) throws ReflectiveOperationException {
    Object type = invoke(event, "getTransactionType");
    String name = type == null ? "" : type.toString().toUpperCase(Locale.ROOT);
    return name.contains("SELL");
  }

  private static boolean isSuccessfulTransaction(Object event) throws ReflectiveOperationException {
    Object result = invoke(event, "getTransactionResult");
    String name = result == null ? "" : result.toString();
    return name.startsWith("SUCCESS");
  }

  private static long resolveVaultAmountMinor(Object event) throws ReflectiveOperationException {
    Object prices = invoke(event, "getPrices");
    if (prices instanceof Map<?, ?> priceMap && !priceMap.isEmpty()) {
      double total = 0;
      for (Map.Entry<?, ?> entry : priceMap.entrySet()) {
        Object ecoType = entry.getKey();
        String ecoName = ecoType == null ? "" : ecoType.toString().toUpperCase(Locale.ROOT);
        if (ecoName.contains("VAULT")) {
          total += toDouble(entry.getValue());
        }
      }
      if (total > 0) {
        return dollarsToMinor(total);
      }
    }
    return dollarsToMinor(toDouble(invoke(event, "getPrice")));
  }

  private static String buildEventId(Object event, java.util.UUID playerUuid, long amountMinor)
      throws ReflectiveOperationException {
    Object type = invoke(event, "getTransactionType");
    String typeName = type == null ? "UNKNOWN" : type.toString();
    String itemPath = "unknown";
    Object shopItem = invoke(event, "getShopItem");
    if (shopItem != null) {
      try {
        Object path = invoke(shopItem, "getItemPath");
        if (path != null && !path.toString().isBlank()) {
          itemPath = path.toString();
        }
      } catch (RuntimeException ignored) {
        itemPath = shopItem.getClass().getSimpleName();
      }
    }
    int amount = (int) toDouble(invoke(event, "getAmount"));
    return typeName + ":" + itemPath + ":" + amount + ":" + amountMinor + ":" + playerUuid;
  }

  private static long dollarsToMinor(double dollars) {
    if (Double.isNaN(dollars) || Double.isInfinite(dollars) || dollars <= 0) {
      return 0;
    }
    return Math.round(dollars * 100.0);
  }

  private static double toDouble(Object value) {
    if (value instanceof Number number) {
      return number.doubleValue();
    }
    if (value == null) {
      return 0;
    }
    try {
      return Double.parseDouble(value.toString());
    } catch (NumberFormatException ignored) {
      return 0;
    }
  }

  private static Object invoke(Object target, String methodName) throws ReflectiveOperationException {
    Method method = target.getClass().getMethod(methodName);
    return method.invoke(target);
  }
}
