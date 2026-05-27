package com.realfiction.realcore.economy;

import com.realfiction.realcore.config.GameplayEconomyProducerConfig;
import com.realfiction.realcore.config.RealCoreConfig;
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
 * Captures EconomyShopGUI buy {@code PostTransactionEvent} instances via reflection.
 *
 * <p>Disabled by default. When enabled with dry-run, events are logged and counted only;
 * no Vault mutation and no ledger HTTP writes occur until a later rollout phase.
 */
public final class EconomyShopGuiBuyProducer implements GameplayEconomyProducer, Listener {
  public static final String ID = "economyShopGuiBuy";
  public static final String SOURCE = "EconomyShopGUI";

  private final Plugin plugin;
  private final RealCoreConfig config;
  private final GameplayEconomyProducerConfig producerConfig;
  private final GameplayEconomyCaptureService captureService;
  private final GameplayEconomyProducerMetrics metrics;
  private final Logger logger;

  private volatile boolean running;
  private volatile String hookStatus = "not started";

  public EconomyShopGuiBuyProducer(
      Plugin plugin,
      RealCoreConfig config,
      GameplayEconomyCaptureService captureService,
      Logger logger
  ) {
    this.plugin = Objects.requireNonNull(plugin, "plugin");
    this.config = Objects.requireNonNull(config, "config");
    this.producerConfig = config.economy().gameplaySync().producers().economyShopGuiBuy();
    this.captureService = Objects.requireNonNull(captureService, "captureService");
    this.metrics = new GameplayEconomyProducerMetrics();
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
      hookStatus = "listening for PostTransactionEvent (BUY)";
      logger.info("Gameplay sync EconomyShopGUI buy producer registered.");
    } catch (ClassNotFoundException error) {
      hookStatus = "PostTransactionEvent class not found";
      logger.log(Level.WARNING, "EconomyShopGUI API classes unavailable; buy producer inactive.", error);
    } catch (RuntimeException error) {
      hookStatus = "registration failed: " + error.getMessage();
      logger.log(Level.WARNING, "EconomyShopGUI buy producer registration failed.", error);
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
      if (!EconomyShopGuiPostTransactionSupport.isBuyTransaction(event)
          || !EconomyShopGuiPostTransactionSupport.isSuccessfulTransaction(event)) {
        return;
      }
      Player player = (Player) EconomyShopGuiPostTransactionSupport.invoke(event, "getPlayer");
      if (player == null) {
        return;
      }
      long amountMinor = EconomyShopGuiPostTransactionSupport.resolveVaultAmountMinor(event);
      if (amountMinor <= 0) {
        return;
      }
      String eventId = EconomyShopGuiPostTransactionSupport.buildEventId(event, player.getUniqueId(), amountMinor);
      captureService.capture(new GameplayEconomyCaptureService.CaptureRequest(
          ID,
          producerConfig,
          player.getUniqueId(),
          player.getName(),
          amountMinor,
          SOURCE,
          eventId,
          "EconomyShopGUI buy",
          metrics
      ));
    } catch (ReflectiveOperationException | RuntimeException error) {
      logger.log(Level.FINE, "EconomyShopGUI buy capture skipped", error);
    }
  }

  private boolean isEconomyShopGuiPresent() {
    return Bukkit.getPluginManager().getPlugin("EconomyShopGUI") != null
        || Bukkit.getPluginManager().getPlugin("EconomyShopGUI-Premium") != null;
  }

  @SuppressWarnings("unchecked")
  private static Class<? extends Event> eventClass() throws ClassNotFoundException {
    return (Class<? extends Event>) Class.forName(EconomyShopGuiPostTransactionSupport.EVENT_CLASS);
  }
}
