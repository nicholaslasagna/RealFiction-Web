package com.realfiction.realcore.economy;

import com.realfiction.realcore.config.GameplayEconomyProducerConfig;
import com.realfiction.realcore.config.GameplayEconomyProducersConfig;
import com.realfiction.realcore.config.GameplayEconomySyncConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;

/**
 * Shared capture pipeline for gameplay economy producers.
 */
public final class GameplayEconomyCaptureService {
  public record CaptureRequest(
      String producerId,
      GameplayEconomyProducerConfig producerConfig,
      UUID minecraftUuid,
      String minecraftUsername,
      long amountMinor,
      String source,
      String eventId,
      String reason,
      GameplayEconomyProducerMetrics metrics
  ) {
    public CaptureRequest {
      Objects.requireNonNull(producerId, "producerId");
      Objects.requireNonNull(producerConfig, "producerConfig");
      Objects.requireNonNull(minecraftUuid, "minecraftUuid");
      Objects.requireNonNull(source, "source");
      Objects.requireNonNull(eventId, "eventId");
      Objects.requireNonNull(metrics, "metrics");
    }
  }

  private final RealCoreConfig config;
  private final GameplayEconomySyncConfig gameplayConfig;
  private final GameplayEconomyProducersConfig producersConfig;
  private final GameplayEconomyTransactionBuffer buffer;
  private final GameplayEconomyIdempotencyDedupCache dedupCache;
  private final GameplayEconomyWriterMetrics gameplayMetrics;
  private final GameplaySyncLogger syncLogger;
  private final Logger logger;
  private final AtomicInteger eventsThisFlushWindow = new AtomicInteger();

  public GameplayEconomyCaptureService(
      RealCoreConfig config,
      GameplayEconomyTransactionBuffer buffer,
      GameplayEconomyIdempotencyDedupCache dedupCache,
      GameplayEconomyWriterMetrics gameplayMetrics,
      GameplaySyncLogger syncLogger,
      Logger logger
  ) {
    this.config = Objects.requireNonNull(config, "config");
    this.gameplayConfig = config.economy().gameplaySync();
    this.producersConfig = gameplayConfig.producers();
    this.buffer = buffer;
    this.dedupCache = dedupCache;
    this.gameplayMetrics = gameplayMetrics;
    this.syncLogger = syncLogger == null ? new GameplaySyncLogger(logger) : syncLogger;
    this.logger = logger == null ? Logger.getLogger("RealCore") : logger;
  }

  public void resetFlushWindow() {
    eventsThisFlushWindow.set(0);
  }

  public int drainFlushWindowCount() {
    return eventsThisFlushWindow.getAndSet(0);
  }

  public void capture(CaptureRequest request) {
    GameplayEconomyProducerMetrics metrics = request.metrics();
    String guard = guardReason(request.producerConfig());
    if (guard != null) {
      if (guard.contains("producer") && guard.contains("disabled")) {
        metrics.recordProducerDisabledRejected();
      } else {
        metrics.recordInvalidRejected();
      }
      return;
    }

    if (eventsThisFlushWindow.incrementAndGet() > request.producerConfig().maxEventsPerFlush()) {
      metrics.recordInvalidRejected();
      syncLogger.warnOnce("producer-cap", "maxEventsPerFlush exceeded for " + request.producerId());
      return;
    }

    if (request.amountMinor() <= 0) {
      metrics.recordInvalidRejected();
      return;
    }

    GameplayEconomyCategory category = request.producerConfig().category();
    if (category.credit()) {
      if (request.amountMinor() > gameplayConfig.maxCreditMinorPerTx()) {
        metrics.recordOverCapRejected();
        return;
      }
    } else if (request.amountMinor() > gameplayConfig.maxDebitMinorPerTx()) {
      metrics.recordOverCapRejected();
      return;
    }

    String idempotencyKey = GameplayEconomyIdempotencyKeys.build(
        config.serverId(),
        category,
        request.source(),
        request.minecraftUuid(),
        request.eventId()
    );

    if (!dedupCache.markIfAbsent(idempotencyKey)) {
      metrics.recordDuplicateRejected();
      syncLogger.warnOnce("duplicate-storm", "duplicate event rejected for " + idempotencyKey);
      return;
    }

    metrics.recordCaptured();
    metrics.setLastEventSummary(formatSummary(request, category));

    boolean dryRun = request.producerConfig().dryRun() || gameplayConfig.dryRun();
    if (dryRun) {
      metrics.recordDryRunCaptured();
      if (gameplayMetrics != null) {
        gameplayMetrics.recordDryRunSimulatedTransaction(request.amountMinor());
      }
      if (request.producerConfig().logEvents()) {
        logger.info(formatDryRunLog(request, category));
      }
      return;
    }

    GameplayEconomyTransactionBuffer.Proposal proposal = new GameplayEconomyTransactionBuffer.Proposal(
        request.minecraftUuid(),
        request.minecraftUsername(),
        request.amountMinor(),
        category,
        request.source(),
        request.eventId(),
        request.reason()
    );
    GameplayEconomyTransactionBuffer.Result result = buffer.propose(proposal);
    if (result.accepted()) {
      metrics.recordQueued();
      if (request.producerConfig().logEvents()) {
        logger.info("[GameplaySync:QUEUE] " + formatSummary(request, category));
      }
      return;
    }
    if (result.dryRun()) {
      metrics.recordDryRunCaptured();
      if (request.producerConfig().logEvents()) {
        logger.info(formatDryRunLog(request, category));
      }
      return;
    }
    if (result.message() != null && result.message().contains("maxCreditMinorPerTx")) {
      metrics.recordOverCapRejected();
    } else {
      metrics.recordInvalidRejected();
    }
  }

  public String guardReason(GameplayEconomyProducerConfig producerConfig) {
    if (!producerConfig.enabled()) {
      return "economy.gameplaySync.producers producer is disabled";
    }
    if (!config.modules().economy()) {
      return "modules.economy is false";
    }
    if (!config.economy().enabled()) {
      return "economy.enabled is false";
    }
    if (!gameplayConfig.enabled()) {
      return "economy.gameplaySync.enabled is false";
    }
    if ("anarchy".equalsIgnoreCase(config.serverGroup())) {
      return "Anarchy may not mutate the global economy";
    }
    String serverId = config.serverId() == null ? "" : config.serverId().trim().toLowerCase(Locale.ROOT);
    if (!gameplayConfig.backendAllowlist().contains(serverId)) {
      return "server.id is not in economy.gameplaySync.backendAllowlist";
    }
    if (!producerConfig.category().enabledBy(gameplayConfig)) {
      return "category " + producerConfig.category().ledgerCategory().apiValue() + " is disabled in config";
    }
    return null;
  }

  private String formatDryRunLog(CaptureRequest request, GameplayEconomyCategory category) {
    return "[GameplaySync:DRYRUN]"
        + " server=" + config.serverId()
        + " category=" + category.ledgerCategory().apiValue()
        + " player=" + request.minecraftUsername() + "(" + request.minecraftUuid() + ")"
        + " amountMinor=" + request.amountMinor()
        + " source=" + request.source()
        + " eventId=" + request.eventId();
  }

  private String formatSummary(CaptureRequest request, GameplayEconomyCategory category) {
    return request.producerId()
        + " " + category.ledgerCategory().apiValue()
        + " " + request.minecraftUsername()
        + " amountMinor=" + request.amountMinor()
        + " eventId=" + request.eventId();
  }
}
