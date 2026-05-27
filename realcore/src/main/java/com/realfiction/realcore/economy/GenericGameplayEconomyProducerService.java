package com.realfiction.realcore.economy;

import com.realfiction.realcore.config.GameplayEconomyGenericConfig;
import com.realfiction.realcore.config.GameplayEconomySyncConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import java.util.Locale;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Internal API for future RealCore-owned gameplay economy events ({@code gameplay_earn},
 * {@code gameplay_spend}). Disabled by default; no gameplay features are wired in Phase 27.
 */
public final class GenericGameplayEconomyProducerService implements GameplayEconomyProducer {
  public static final String ID = "genericGameplay";

  private final RealCoreConfig config;
  private final GameplayEconomySyncConfig gameplayConfig;
  private final GameplayEconomyGenericConfig genericConfig;
  private final GameplayEconomyTransactionBuffer buffer;
  private final GameplayEconomyIdempotencyDedupCache dedupCache;
  private final GameplayEconomyProducerMetrics metrics;
  private final GameplayEconomyWriterMetrics gameplayMetrics;
  private final GameplaySyncLogger syncLogger;
  private final Logger logger;
  private final AtomicInteger eventsThisFlushWindow = new AtomicInteger();

  public GenericGameplayEconomyProducerService(
      RealCoreConfig config,
      GameplayEconomyTransactionBuffer buffer,
      GameplayEconomyIdempotencyDedupCache dedupCache,
      GameplayEconomyWriterMetrics gameplayMetrics,
      GameplaySyncLogger syncLogger,
      Logger logger
  ) {
    this.config = Objects.requireNonNull(config, "config");
    this.gameplayConfig = config.economy().gameplaySync();
    this.genericConfig = gameplayConfig.generic();
    this.buffer = Objects.requireNonNull(buffer, "buffer");
    this.dedupCache = Objects.requireNonNull(dedupCache, "dedupCache");
    this.metrics = new GameplayEconomyProducerMetrics();
    this.gameplayMetrics = gameplayMetrics;
    this.syncLogger = syncLogger == null ? new GameplaySyncLogger(logger) : syncLogger;
    this.logger = logger == null ? Logger.getLogger("RealCore") : logger;
  }

  public record SubmitResult(boolean accepted, boolean dryRun, String rejectionReason) {
    public static SubmitResult rejected(String reason) {
      return new SubmitResult(false, false, reason);
    }

    public static SubmitResult dryRunAccepted() {
      return new SubmitResult(true, true, null);
    }

    public static SubmitResult queued() {
      return new SubmitResult(true, false, null);
    }
  }

  @Override
  public String id() {
    return ID;
  }

  @Override
  public void start() {
    // No Bukkit hooks; internal API only.
  }

  @Override
  public void stop() {
    eventsThisFlushWindow.set(0);
  }

  @Override
  public boolean running() {
    return genericConfig.enabled();
  }

  @Override
  public GameplayEconomyProducerMetrics metrics() {
    return metrics;
  }

  @Override
  public String statusSummary() {
    if (!genericConfig.enabled()) {
      return "disabled by config";
    }
    return "internal API only (no gameplay hooks)";
  }

  public GameplayEconomyGenericConfig genericConfig() {
    return genericConfig;
  }

  /**
   * Submit a validated gameplay economy event. Future RealCore systems call this method.
   */
  public SubmitResult submit(GameplayEconomyEvent event) {
    Objects.requireNonNull(event, "event");

    String rejection = validate(event);
    if (rejection != null) {
      recordRejection(rejection, rejection.contains("disabled"));
      return SubmitResult.rejected(rejection);
    }

    if (eventsThisFlushWindow.incrementAndGet() > GameplayEconomyGenericConfig.DEFAULT_MAX_EVENTS_PER_FLUSH) {
      String capReason = "maxEventsPerFlush exceeded for " + ID;
      recordRejection(capReason, false);
      syncLogger.warnOnce("generic-producer-cap", capReason);
      return SubmitResult.rejected(capReason);
    }

    String idempotencyKey = GameplayEconomyIdempotencyKeys.build(
        config.serverId(),
        event.category(),
        event.source(),
        event.playerUuid(),
        event.eventId()
    );
    if (!dedupCache.markIfAbsent(idempotencyKey)) {
      metrics.recordDuplicateRejected();
      metrics.setLastRejectionReason("duplicate: " + idempotencyKey);
      syncLogger.warnOnce("generic-duplicate", "duplicate event rejected for " + idempotencyKey);
      return SubmitResult.rejected("duplicate event");
    }

    metrics.recordCaptured();
    metrics.setLastEventSummary(formatSummary(event));

    boolean dryRun = genericConfig.dryRun() || gameplayConfig.dryRun();
    if (dryRun) {
      metrics.recordDryRunCaptured();
      if (gameplayMetrics != null) {
        gameplayMetrics.recordDryRunSimulatedTransaction(event.amountMinor());
      }
      if (genericConfig.logEvents()) {
        logger.info(formatDryRunLog(event));
      }
      return SubmitResult.dryRunAccepted();
    }

    GameplayEconomyTransactionBuffer.Proposal proposal = new GameplayEconomyTransactionBuffer.Proposal(
        event.playerUuid(),
        event.playerName(),
        event.amountMinor(),
        event.category(),
        event.source(),
        event.eventId(),
        event.reason()
    );
    GameplayEconomyTransactionBuffer.Result result = buffer.propose(proposal);
    if (result.accepted()) {
      metrics.recordQueued();
      if (genericConfig.logEvents()) {
        logger.info("[GameplaySync:QUEUE] " + formatSummary(event));
      }
      return SubmitResult.queued();
    }
    if (result.dryRun()) {
      metrics.recordDryRunCaptured();
      if (genericConfig.logEvents()) {
        logger.info(formatDryRunLog(event));
      }
      return SubmitResult.dryRunAccepted();
    }
    String bufferReason = result.message() == null ? "buffer rejected proposal" : result.message();
    if (bufferReason.contains("maxCreditMinorPerTx") || bufferReason.contains("maxDebitMinorPerTx")) {
      metrics.recordOverCapRejected();
    } else {
      metrics.recordRejected();
    }
    metrics.setLastRejectionReason(bufferReason);
    return SubmitResult.rejected(bufferReason);
  }

  private String validate(GameplayEconomyEvent event) {
    if (!genericConfig.enabled()) {
      return "economy.gameplaySync.generic.enabled is false";
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
    if (event.playerUuid() == null) {
      return "playerUuid is required";
    }
    if (event.eventId().isBlank()) {
      return "eventId is required";
    }
    if (event.source().isBlank()) {
      return "source is required";
    }
    if (!genericConfig.sourceAllowlisted(event.source())) {
      return "source is not in economy.gameplaySync.generic.allowedSources";
    }
    GameplayEconomyCategory category = event.category();
    if (category != GameplayEconomyCategory.GAMEPLAY_EARN && category != GameplayEconomyCategory.GAMEPLAY_SPEND) {
      return "unsupported category " + category.ledgerCategory().apiValue();
    }
    if (category == GameplayEconomyCategory.GAMEPLAY_EARN) {
      if (!genericConfig.allowGameplayEarn()) {
        return "economy.gameplaySync.generic.allowGameplayEarn is false";
      }
      if (!gameplayConfig.gameplayEarn()) {
        return "category gameplay_earn is disabled in config";
      }
    }
    if (category == GameplayEconomyCategory.GAMEPLAY_SPEND) {
      if (!genericConfig.allowGameplaySpend()) {
        return "economy.gameplaySync.generic.allowGameplaySpend is false";
      }
      if (!gameplayConfig.gameplaySpend()) {
        return "category gameplay_spend is disabled in config";
      }
    }
    if (event.amountMinor() <= 0) {
      return "amountMinor must be greater than zero";
    }
    if (category.credit()) {
      if (event.amountMinor() > genericConfig.maxCreditMinorPerEvent()) {
        return "amountMinor exceeds economy.gameplaySync.generic.maxCreditMinorPerEvent";
      }
    } else if (event.amountMinor() > genericConfig.maxDebitMinorPerEvent()) {
      return "amountMinor exceeds economy.gameplaySync.generic.maxDebitMinorPerEvent";
    }
    return null;
  }

  private void recordRejection(String reason, boolean disabled) {
    if (disabled) {
      metrics.recordProducerDisabledRejected();
    } else if (reason != null && (reason.contains("exceeds") || reason.contains("maxCreditMinor") || reason.contains("maxDebitMinor"))) {
      metrics.recordOverCapRejected();
    } else {
      metrics.recordRejected();
    }
    metrics.setLastRejectionReason(reason);
    if (logger.isLoggable(Level.FINE)) {
      logger.fine("Generic gameplay economy event rejected: " + reason);
    }
  }

  private String formatDryRunLog(GameplayEconomyEvent event) {
    return "[GameplaySync:DRYRUN]"
        + " server=" + config.serverId()
        + " category=" + event.category().ledgerCategory().apiValue()
        + " player=" + event.playerName() + "(" + event.playerUuid() + ")"
        + " amountMinor=" + event.amountMinor()
        + " source=" + event.source()
        + " eventId=" + event.eventId();
  }

  private String formatSummary(GameplayEconomyEvent event) {
    return ID
        + " " + event.category().ledgerCategory().apiValue()
        + " " + event.playerName()
        + " amountMinor=" + event.amountMinor()
        + " source=" + event.source()
        + " eventId=" + event.eventId();
  }
}
