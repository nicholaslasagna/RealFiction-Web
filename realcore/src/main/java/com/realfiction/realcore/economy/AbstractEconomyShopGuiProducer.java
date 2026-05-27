package com.realfiction.realcore.economy;

import com.realfiction.realcore.config.GameplayEconomyProducerConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import java.util.Objects;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.event.Event;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.plugin.Plugin;

/**
 * Shared EconomyShopGUI {@code PostTransactionEvent} hook for sell/buy producers.
 */
abstract class AbstractEconomyShopGuiProducer implements GameplayEconomyProducer, Listener {
  private final String producerId;
  private final Plugin plugin;
  private final GameplayEconomyProducerConfig producerConfig;
  private final GameplayEconomyCaptureService captureService;
  private final GameplayEconomyProducerMetrics metrics;
  private final Logger logger;

  private volatile boolean running;
  private volatile String hookStatus = "not started";

  protected AbstractEconomyShopGuiProducer(
      String producerId,
      Plugin plugin,
      RealCoreConfig config,
      GameplayEconomyCaptureService captureService,
      Logger logger,
      GameplayEconomyProducerConfig producerConfig
  ) {
    this.producerId = Objects.requireNonNull(producerId, "producerId");
    this.plugin = Objects.requireNonNull(plugin, "plugin");
    this.captureService = Objects.requireNonNull(captureService, "captureService");
    this.producerConfig = Objects.requireNonNull(producerConfig, "producerConfig");
    this.metrics = captureService.metricsForProducer(producerId);
    this.logger = logger == null ? Logger.getLogger("RealCore") : logger;
    Objects.requireNonNull(config, "config");
  }

  protected abstract boolean acceptsTransactionType(String typeNameUpper);

  protected abstract String hookLabel();

  protected abstract String registrationLogMessage();

  protected abstract String captureReasonLabel();

  @Override
  public String id() {
    return producerId;
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
    if (!EconomyShopGuiPostTransactionSupport.isEconomyShopGuiPresent()) {
      hookStatus = "EconomyShopGUI not installed";
      return;
    }
    try {
      Class<? extends Event> eventClass = EconomyShopGuiPostTransactionSupport.eventClass();
      Bukkit.getPluginManager().registerEvent(
          eventClass,
          this,
          EventPriority.MONITOR,
          (listener, event) -> handlePostTransaction(event),
          plugin,
          false
      );
      running = true;
      hookStatus = "listening for PostTransactionEvent (" + hookLabel() + ")";
      logger.info(registrationLogMessage());
    } catch (ClassNotFoundException error) {
      hookStatus = "PostTransactionEvent class not found";
      logger.log(Level.WARNING, "EconomyShopGUI API classes unavailable; " + producerId + " inactive.", error);
    } catch (RuntimeException error) {
      hookStatus = "registration failed: " + error.getMessage();
      logger.log(Level.WARNING, "EconomyShopGUI producer registration failed for " + producerId + ".", error);
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
      String typeName = EconomyShopGuiPostTransactionSupport.transactionTypeName(event);
      if (!acceptsTransactionType(typeName)) {
        return;
      }
      if (!EconomyShopGuiPostTransactionSupport.isSuccessfulTransaction(event)) {
        return;
      }
      var player = EconomyShopGuiPostTransactionSupport.requirePlayer(event);
      if (player == null) {
        return;
      }
      long amountMinor = EconomyShopGuiPostTransactionSupport.resolveVaultAmountMinor(event);
      if (amountMinor <= 0) {
        return;
      }
      String eventId = EconomyShopGuiPostTransactionSupport.buildEventId(event, player.getUniqueId(), amountMinor);
      captureService.capture(new GameplayEconomyCaptureService.CaptureRequest(
          producerId,
          producerConfig,
          player.getUniqueId(),
          player.getName(),
          amountMinor,
          EconomyShopGuiSellProducer.SOURCE,
          eventId,
          captureReasonLabel()
      ));
    } catch (ReflectiveOperationException | RuntimeException error) {
      logger.log(Level.FINE, "EconomyShopGUI capture skipped for " + producerId, error);
    }
  }

  static boolean matchesSellTransactionType(String typeNameUpper) {
    return typeNameUpper.contains("SELL") && !typeNameUpper.contains("BUY");
  }

  static boolean matchesBuyTransactionType(String typeNameUpper) {
    return typeNameUpper.contains("BUY") && !typeNameUpper.contains("SELL");
  }
}
