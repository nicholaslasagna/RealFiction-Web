package com.realfiction.realcore.economy;

import com.realfiction.realcore.config.EconomyConfig;
import com.realfiction.realcore.config.GameplayEconomySyncConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Safety layer for future gameplay economy producers.
 *
 * <p>Validates proposals and optionally enqueues to {@link BufferedEconomyTransactionWriter}
 * through {@link EconomyService}. No Vault, shop, or command hooks are attached in
 * Phase 8.
 */
public final class GameplayEconomyTransactionBuffer {
  public enum Outcome {
    ACCEPTED,
    DRY_RUN,
    REJECTED
  }

  public record Proposal(
      UUID minecraftUuid,
      String minecraftUsername,
      long amountMinor,
      GameplayEconomyCategory category,
      String source,
      String eventId,
      String reason
  ) {
    public Proposal {
      Objects.requireNonNull(minecraftUuid, "minecraftUuid");
      Objects.requireNonNull(category, "category");
    }
  }

  public record Result(Outcome outcome, String message) {
    public boolean accepted() {
      return outcome == Outcome.ACCEPTED;
    }

    public boolean dryRun() {
      return outcome == Outcome.DRY_RUN;
    }

    public boolean rejected() {
      return outcome == Outcome.REJECTED;
    }
  }

  private final RealCoreConfig config;
  private final EconomyConfig economyConfig;
  private final GameplayEconomySyncConfig gameplayConfig;
  private final EconomyService economyService;
  private final Logger logger;

  private final AtomicLong acceptedCount = new AtomicLong();
  private final AtomicLong dryRunCount = new AtomicLong();
  private final AtomicLong rejectedCount = new AtomicLong();
  private volatile String lastAcceptedMessage = "";
  private volatile String lastRejectedMessage = "";

  public GameplayEconomyTransactionBuffer(
      RealCoreConfig config,
      EconomyService economyService,
      Logger logger
  ) {
    this.config = Objects.requireNonNull(config, "config");
    this.economyConfig = config.economy();
    this.gameplayConfig = economyConfig.gameplaySync();
    this.economyService = economyService;
    this.logger = logger == null ? Logger.getLogger("RealCore") : logger;
  }

  public Result propose(Proposal proposal) {
    String rejection = validate(proposal);
    if (rejection != null) {
      rejectedCount.incrementAndGet();
      lastRejectedMessage = rejection;
      return new Result(Outcome.REJECTED, rejection);
    }

    EconomyTransaction transaction = toTransaction(proposal);
    if (gameplayConfig.dryRun()) {
      dryRunCount.incrementAndGet();
      String message = "dry-run: would queue " + transaction.category().apiValue()
          + " amountMinor=" + transaction.amountMinor()
          + " idempotency=" + transaction.idempotencyKey();
      lastAcceptedMessage = message;
      if (gameplayConfig.logTransactions()) {
        logger.info("[gameplay-sync] " + message);
      }
      return new Result(Outcome.DRY_RUN, message);
    }

    if (economyService == null || !economyService.writerRunning()) {
      String message = economyService == null
          ? "global economy service is not loaded"
          : "global economy writer is not running"
              + (economyService.disabledReason().isBlank() ? "" : ": " + economyService.disabledReason());
      rejectedCount.incrementAndGet();
      lastRejectedMessage = message;
      return new Result(Outcome.REJECTED, message);
    }

    if (!economyService.enqueue(transaction)) {
      String message = "BufferedEconomyTransactionWriter rejected enqueue (buffer full or not running)";
      rejectedCount.incrementAndGet();
      lastRejectedMessage = message;
      return new Result(Outcome.REJECTED, message);
    }

    acceptedCount.incrementAndGet();
    String message = "queued " + transaction.category().apiValue()
        + " amountMinor=" + transaction.amountMinor()
        + " idempotency=" + transaction.idempotencyKey();
    lastAcceptedMessage = message;
    if (gameplayConfig.logTransactions()) {
      logger.info("[gameplay-sync] " + message);
    }
    return new Result(Outcome.ACCEPTED, message);
  }

  public boolean configuredEnabled() {
    return gameplayConfig.enabled();
  }

  public boolean configuredDryRun() {
    return gameplayConfig.dryRun();
  }

  public GameplayEconomySyncConfig gameplayConfig() {
    return gameplayConfig;
  }

  public long acceptedCount() {
    return acceptedCount.get();
  }

  public long dryRunCount() {
    return dryRunCount.get();
  }

  public long rejectedCount() {
    return rejectedCount.get();
  }

  public String lastAcceptedMessage() {
    return lastAcceptedMessage;
  }

  public String lastRejectedMessage() {
    return lastRejectedMessage;
  }

  public int writerQueuedCount() {
    return economyService == null ? 0 : economyService.writer().queuedTransactionCount();
  }

  private String validate(Proposal proposal) {
    if (!config.modules().economy()) {
      return "modules.economy is false";
    }
    if (!economyConfig.enabled()) {
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
    if (!proposal.category.enabledBy(gameplayConfig)) {
      return "category " + proposal.category.ledgerCategory().apiValue() + " is disabled in config";
    }
    if (proposal.amountMinor <= 0) {
      return "amountMinor must be greater than zero";
    }
    if (proposal.category.credit()) {
      if (proposal.amountMinor > gameplayConfig.maxCreditMinorPerTx()) {
        return "amountMinor exceeds economy.gameplaySync.maxCreditMinorPerTx";
      }
    } else if (proposal.amountMinor > gameplayConfig.maxDebitMinorPerTx()) {
      return "amountMinor exceeds economy.gameplaySync.maxDebitMinorPerTx";
    }
    if (proposal.source == null || proposal.source.isBlank()) {
      return "source is required";
    }
    if (proposal.eventId == null || proposal.eventId.isBlank()) {
      return "eventId is required";
    }
    return null;
  }

  private EconomyTransaction toTransaction(Proposal proposal) {
    String idempotencyKey = GameplayEconomyIdempotencyKeys.build(
        config.serverId(),
        proposal.category,
        proposal.source,
        proposal.minecraftUuid,
        proposal.eventId
    );
    String reason = proposal.reason == null || proposal.reason.isBlank()
        ? proposal.category.ledgerCategory().apiValue()
        : proposal.reason.trim();
    String externalRefType = proposal.source.trim().toLowerCase(Locale.ROOT);
    String externalRefId = proposal.eventId.trim();
    Map<String, Object> metadata = Map.of(
        "source", "gameplay_sync_buffer",
        "gameplaySource", externalRefType,
        "gameplayEventId", externalRefId
    );

    if (proposal.category.credit()) {
      return EconomyTransaction.credit(
          proposal.minecraftUuid,
          proposal.minecraftUsername,
          proposal.amountMinor,
          proposal.category.ledgerCategory(),
          reason,
          idempotencyKey,
          externalRefType,
          externalRefId,
          metadata
      );
    }
    return EconomyTransaction.debit(
        proposal.minecraftUuid,
        proposal.minecraftUsername,
        proposal.amountMinor,
        proposal.category.ledgerCategory(),
        reason,
        idempotencyKey,
        externalRefType,
        externalRefId,
        metadata
    );
  }
}
