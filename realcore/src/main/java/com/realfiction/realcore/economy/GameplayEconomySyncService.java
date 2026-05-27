package com.realfiction.realcore.economy;

import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.util.List;
import java.util.Objects;
import java.util.logging.Logger;
import org.bukkit.plugin.Plugin;

/**
 * Manages gameplay economy producers and the shared capture pipeline.
 */
public final class GameplayEconomySyncService {
  private final Plugin plugin;
  private final RealCoreConfig config;
  private final GameplayEconomyTransactionBuffer buffer;
  private final Logger logger;

  private final GameplayEconomyProducerMetrics metrics = new GameplayEconomyProducerMetrics();
  private final GameplayEconomyIdempotencyDedupCache dedupCache;
  private final GameplayEconomyCaptureService captureService;
  private final List<GameplayEconomyProducer> producers;
  private ScheduledTaskHandle flushWindowTask;

  public GameplayEconomySyncService(
      Plugin plugin,
      RealCoreConfig config,
      GameplayEconomyTransactionBuffer buffer,
      RealCoreScheduler scheduler,
      Logger logger
  ) {
    this.plugin = Objects.requireNonNull(plugin, "plugin");
    this.config = Objects.requireNonNull(config, "config");
    this.buffer = Objects.requireNonNull(buffer, "buffer");
    this.logger = logger == null ? Logger.getLogger("RealCore") : logger;
    this.dedupCache = new GameplayEconomyIdempotencyDedupCache(
        config.economy().gameplaySync().producers().dedupCacheTtl(),
        config.economy().gameplaySync().producers().dedupCacheMaxEntries()
    );
    this.captureService = new GameplayEconomyCaptureService(config, buffer, dedupCache, metrics, logger);
    EconomyShopGuiSellProducer economyShopGuiSell = new EconomyShopGuiSellProducer(plugin, config, captureService, logger);
    this.producers = List.of(economyShopGuiSell);
    long flushSeconds = Math.max(5, config.economy().gameplaySync().flushInterval().toSeconds());
    if (scheduler != null) {
      this.flushWindowTask = scheduler.runAsyncRepeating(
          captureService::resetFlushWindow,
          flushSeconds,
          flushSeconds
      );
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
    for (GameplayEconomyProducer producer : producers) {
      producer.stop();
    }
  }

  public GameplayEconomyCaptureService captureService() {
    return captureService;
  }

  public GameplayEconomyProducerMetrics metrics() {
    return metrics;
  }

  public int dedupCacheSize() {
    return dedupCache.size();
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
