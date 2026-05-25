package com.realfiction.realcore.economy;

import com.realfiction.realcore.api.dto.EconomyTransactionsRequest;
import com.realfiction.realcore.api.dto.EconomyTransactionsResponse;
import com.realfiction.realcore.api.dto.RewardPayload;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.config.RewardEconomyConfig;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Logger;

/**
 * Phase 6E real vote reward ledger write service.
 *
 * <p>This service is deliberately separate from shadow mode. It has no Vault or
 * EssentialsX dependency and can only submit an append-only economy transaction
 * through the existing signed economy API when the explicit real-write flags are
 * enabled.
 */
public final class VoteRewardLedgerWriteService {
  public static final String EXTERNAL_REF_TYPE = "reward_queue";
  public static final String SOURCE = "vote_reward_ledger";

  private final RealCoreConfig config;
  private final EconomyTransactionsTransport transport;
  private final Logger logger;
  private final AtomicLong successCount = new AtomicLong();
  private final AtomicLong duplicateSuccessCount = new AtomicLong();
  private final AtomicLong failureCount = new AtomicLong();
  private final AtomicLong fallbackCount = new AtomicLong();

  public VoteRewardLedgerWriteService(RealCoreConfig config, EconomyTransactionsTransport transport, Logger logger) {
    this.config = config;
    this.transport = transport;
    this.logger = logger;
  }

  public boolean writesEnabled() {
    return config.economy().voteRewardsLedgerWritesEnabled();
  }

  public boolean fallbackCommandsEnabled() {
    return config.economy().voteRewardsLedgerFallbackCommands();
  }

  public boolean canAttempt(RewardPayload reward) {
    return writesEnabled()
        && reward != null
        && isVoteReward(reward.rewardKey)
        && mappingFor(reward).isPresent();
  }

  public CompletableFuture<WriteResult> write(RewardPayload reward) {
    if (!canAttempt(reward)) {
      return CompletableFuture.completedFuture(WriteResult.skipped("Vote reward ledger writes are not enabled or no mapping exists."));
    }
    if (!config.economy().enabled()) {
      failureCount.incrementAndGet();
      return CompletableFuture.completedFuture(WriteResult.failed("economy.enabled is false"));
    }
    if (!config.modules().economy()) {
      failureCount.incrementAndGet();
      return CompletableFuture.completedFuture(WriteResult.failed("modules.economy is false"));
    }
    if (!config.hmacSecretConfigured()) {
      failureCount.incrementAndGet();
      return CompletableFuture.completedFuture(WriteResult.failed("website auth is not configured"));
    }
    if ("anarchy".equalsIgnoreCase(config.serverGroup())) {
      failureCount.incrementAndGet();
      logger.warning("Vote reward ledger write refused: Anarchy is read-only for the global economy.");
      return CompletableFuture.completedFuture(WriteResult.failed("Anarchy is read-only for the global economy."));
    }

    EconomyTransaction transaction;
    try {
      transaction = transactionFor(reward);
    } catch (IllegalArgumentException error) {
      failureCount.incrementAndGet();
      return CompletableFuture.completedFuture(WriteResult.failed(error.getMessage()));
    }

    EconomyTransactionsRequest request = new EconomyTransactionsRequest(
        config.serverId(),
        config.serverGroup(),
        transaction.metadata().get("currencyKey").toString(),
        UUID.randomUUID().toString(),
        java.util.List.of(toDto(transaction))
    );

    return transport.send(request)
        .thenApply(response -> handleResponse(reward, response))
        .exceptionally(error -> {
          failureCount.incrementAndGet();
          String message = rootMessage(error);
          logger.warning("Vote reward ledger write failed: rewardKey=" + reward.rewardKey
              + " rewardId=" + reward.id + " error=" + message);
          return WriteResult.failed(message);
        });
  }

  public EconomyTransaction transactionFor(RewardPayload reward) {
    RewardEconomyConfig.Mapping mapping = mappingFor(reward)
        .orElseThrow(() -> new IllegalArgumentException("No vote reward economy mapping for " + reward.rewardKey));
    UUID uuid = parseUuid(reward.minecraftUuid());
    if (uuid == null) {
      throw new IllegalArgumentException("Reward target is missing a valid Minecraft UUID.");
    }
    return EconomyTransaction.credit(
        uuid,
        reward.minecraftUsername(),
        mapping.amountMinor(),
        EconomyCategory.VOTE_REWARD,
        "Vote reward ledger: " + reward.rewardKey,
        idempotencyKey(reward.id, reward.rewardKey, mapping.currencyKey()),
        EXTERNAL_REF_TYPE,
        requireText(reward.id, "rewardId"),
        metadata(reward, mapping)
    );
  }

  public void recordFallbackUsed() {
    fallbackCount.incrementAndGet();
  }

  public long successCount() {
    return successCount.get();
  }

  public long duplicateSuccessCount() {
    return duplicateSuccessCount.get();
  }

  public long failureCount() {
    return failureCount.get();
  }

  public long fallbackCount() {
    return fallbackCount.get();
  }

  public int mappingCount() {
    return config.rewardEconomy().byRewardKey().size();
  }

  public static String idempotencyKey(String rewardId, String rewardKey, String currencyKey) {
    return "reward:" + requireText(rewardId, "rewardId")
        + ":" + requireText(rewardKey, "rewardKey")
        + ":" + requireText(currencyKey, "currencyKey").toLowerCase(Locale.ROOT);
  }

  private WriteResult handleResponse(RewardPayload reward, EconomyTransactionsResponse response) {
    if (response != null && response.ok && response.applied > 0) {
      successCount.incrementAndGet();
      logger.info("Vote reward ledger write applied: rewardKey=" + reward.rewardKey
          + " rewardId=" + reward.id + " applied=" + response.applied);
      return WriteResult.applied();
    }
    if (response != null && response.ok && (response.duplicates > 0 || response.duplicateBatch)) {
      duplicateSuccessCount.incrementAndGet();
      logger.info("Vote reward ledger write duplicate success: rewardKey=" + reward.rewardKey
          + " rewardId=" + reward.id + " duplicates=" + response.duplicates
          + " duplicateBatch=" + response.duplicateBatch);
      return WriteResult.duplicateSuccess();
    }
    failureCount.incrementAndGet();
    return WriteResult.failed("Economy API did not apply or duplicate the vote reward transaction.");
  }

  private Optional<RewardEconomyConfig.Mapping> mappingFor(RewardPayload reward) {
    if (reward == null || reward.rewardKey == null) {
      return Optional.empty();
    }
    return Optional.ofNullable(config.rewardEconomy().byRewardKey().get(reward.rewardKey));
  }

  private boolean isVoteReward(String rewardKey) {
    return rewardKey != null && rewardKey.toLowerCase(Locale.ROOT).startsWith("vote.");
  }

  private EconomyTransactionsRequest.Transaction toDto(EconomyTransaction transaction) {
    return new EconomyTransactionsRequest.Transaction(
        transaction.minecraftUuid().toString(),
        transaction.minecraftUsername(),
        transaction.amountMinor(),
        transaction.category().apiValue(),
        transaction.reason(),
        transaction.idempotencyKey(),
        transaction.externalRefType(),
        transaction.externalRefId(),
        transaction.metadata()
    );
  }

  private Map<String, Object> metadata(RewardPayload reward, RewardEconomyConfig.Mapping mapping) {
    Map<String, Object> metadata = new LinkedHashMap<>();
    metadata.put("rewardId", reward.id);
    metadata.put("rewardKey", reward.rewardKey);
    metadata.put("minecraftUuid", reward.minecraftUuid());
    metadata.put("minecraftUsername", reward.minecraftUsername());
    metadata.put("serverId", config.serverId());
    metadata.put("serverGroup", config.serverGroup());
    metadata.put("source", SOURCE);
    metadata.put("currencyKey", mapping.currencyKey());
    metadata.put("category", EconomyCategory.VOTE_REWARD.apiValue());
    metadata.put("amountMinor", mapping.amountMinor());
    if (reward.delivery != null && reward.delivery.voteSite != null && !reward.delivery.voteSite.isBlank()) {
      metadata.put("voteSite", reward.delivery.voteSite.trim());
    }
    return metadata;
  }

  private UUID parseUuid(String value) {
    if (value == null || value.isBlank()) {
      return null;
    }
    String normalized = value.trim();
    if (normalized.length() == 32) {
      normalized = normalized.replaceFirst(
          "([0-9a-fA-F]{8})([0-9a-fA-F]{4})([0-9a-fA-F]{4})([0-9a-fA-F]{4})([0-9a-fA-F]{12})",
          "$1-$2-$3-$4-$5"
      );
    }
    try {
      return UUID.fromString(normalized);
    } catch (IllegalArgumentException ignored) {
      return null;
    }
  }

  private static String rootMessage(Throwable error) {
    Throwable cursor = error;
    while (cursor.getCause() != null) {
      cursor = cursor.getCause();
    }
    String message = cursor.getMessage();
    return message == null || message.isBlank() ? cursor.getClass().getSimpleName() : message;
  }

  private static String requireText(String value, String field) {
    if (value == null || value.isBlank()) {
      throw new IllegalArgumentException(field + " is required");
    }
    return value.trim();
  }

  public record WriteResult(boolean delivered, boolean duplicate, String failureReason) {
    public static WriteResult applied() {
      return new WriteResult(true, false, null);
    }

    public static WriteResult duplicateSuccess() {
      return new WriteResult(true, true, null);
    }

    public static WriteResult skipped(String reason) {
      return new WriteResult(false, false, reason);
    }

    public static WriteResult failed(String reason) {
      return new WriteResult(false, false, reason == null || reason.isBlank() ? "Vote reward ledger write failed." : reason);
    }
  }
}
