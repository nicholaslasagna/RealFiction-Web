package com.realfiction.realcore.economy;

import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;
import org.bukkit.plugin.Plugin;

/**
 * Manages gameplay economy producers and the shared capture pipeline.
 */
public final class GameplayEconomySyncService {
  private final Plugin plugin;
  private final RealCoreConfig config;
  private final GameplayEconomyTransactionBuffer buffer;
  private final GameplayEconomyWriterMetrics gameplayMetrics;
  private final GameplaySyncLogger syncLogger;
  private final Logger logger;

  private final GameplayEconomyProducerMetricsRegistry metricsRegistry = new GameplayEconomyProducerMetricsRegistry();
  private final GameplayEconomyIdempotencyDedupCache dedupCache;
  private final GameplayEconomyCaptureService captureService;
  private final List<GameplayEconomyProducer> producers;
  private ScheduledTaskHandle flushWindowTask;
  private ScheduledTaskHandle summaryTask;

  public GameplayEconomySyncService(
      Plugin plugin,
      RealCoreConfig config,
      GameplayEconomyTransactionBuffer buffer,
      GameplayEconomyWriterMetrics gameplayMetrics,
      GameplaySyncLogger syncLogger,
      RealCoreScheduler scheduler,
      Logger logger
  ) {
    this.plugin = Objects.requireNonNull(plugin, "plugin");
    this.config = Objects.requireNonNull(config, "config");
    this.buffer = Objects.requireNonNull(buffer, "buffer");
    this.gameplayMetrics = gameplayMetrics;
    this.syncLogger = syncLogger == null ? new GameplaySyncLogger(logger) : syncLogger;
    this.logger = logger == null ? Logger.getLogger("RealCore") : logger;
    this.dedupCache = new GameplayEconomyIdempotencyDedupCache(
        config.economy().gameplaySync().producers().dedupCacheTtl(),
        config.economy().gameplaySync().producers().dedupCacheMaxEntries()
    );
    this.captureService = new GameplayEconomyCaptureService(
        config, buffer, dedupCache, metricsRegistry, gameplayMetrics, syncLogger, logger);
    EconomyShopGuiSellProducer economyShopGuiSell = new EconomyShopGuiSellProducer(plugin, config, captureService, logger);
    EconomyShopGuiBuyProducer economyShopGuiBuy = new EconomyShopGuiBuyProducer(plugin, config, captureService, logger);
    this.producers = List.of(economyShopGuiSell, economyShopGuiBuy);
    long flushSeconds = Math.max(5, config.economy().gameplaySync().flushInterval().toSeconds());
    if (scheduler != null) {
      this.flushWindowTask = scheduler.runAsyncRepeating(this::onFlushWindowTick, flushSeconds, flushSeconds);
      long summarySeconds = config.economy().gameplaySync().observability().summaryInterval().toSeconds();
      this.summaryTask = scheduler.runAsyncRepeating(this::emitPeriodicSummary, summarySeconds, summarySeconds);
    }
  }

  public void start() {
    for (GameplayEconomyProducer producer : producers) {
      producer.start();
    }
  }

  public void stop() {
    if (flushWindowTask != null) {
      flushWindowTask.cancel();
      flushWindowTask = null;
    }
    if (summaryTask != null) {
      summaryTask.cancel();
      summaryTask = null;
    }
    for (GameplayEconomyProducer producer : producers) {
      producer.stop();
    }
    buffer.clearGameplayQueue();
  }

  private void onFlushWindowTick() {
    int events = captureService.drainFlushWindowCount();
    if (config.economy().gameplaySync().dryRun() && events > 0) {
      buffer.recordDryRunFlushWindow(events);
    } else if (events > 0) {
      buffer.drainToWriter();
    }
  }

  private void emitPeriodicSummary() {
    if (!config.economy().gameplaySync().observability().enabled()) {
      return;
    }
    StringBuilder summary = new StringBuilder();
    summary.append("server=").append(config.serverId());
    summary.append(" captured=").append(metricsRegistry.aggregate().captured());
    summary.append(" dryRun=").append(metricsRegistry.aggregate().dryRunCaptured());
    summary.append(" queued=").append(metricsRegistry.aggregate().queued());
    if (gameplayMetrics != null) {
      summary.append(" gameplayQueued=").append(gameplayMetrics.gameplayQueued());
      summary.append(" gameplayOk=").append(gameplayMetrics.gameplaySucceeded());
      summary.append(" gameplayFail=").append(gameplayMetrics.gameplayFailures());
      summary.append(" dryRunSimTx=").append(gameplayMetrics.dryRunSimulatedTransactions());
    }
    summary.append(" dedupKeys=").append(dedupCache.size());
    syncLogger.summary(summary.toString());
  }

  public GameplayEconomyCaptureService captureService() {
    return captureService;
  }

  public GameplayEconomyProducerMetrics metrics() {
    return metricsRegistry.aggregate();
  }

  public GameplayEconomyProducerMetricsRegistry metricsRegistry() {
    return metricsRegistry;
  }

  public GameplayEconomyWriterMetrics gameplayMetrics() {
    return gameplayMetrics;
  }

  public int dedupCacheSize() {
    return dedupCache.size();
  }

  public int dedupCacheMaxEntries() {
    return config.economy().gameplaySync().producers().dedupCacheMaxEntries();
  }

  public List<GameplayEconomyProducer> producers() {
    return producers;
  }

  public GameplayEconomyProducer producer(String id) {
    for (GameplayEconomyProducer producer : producers) {
      if (producer.id().equals(id)) {
        return producer;
      }
    }
    return null;
  }
}
