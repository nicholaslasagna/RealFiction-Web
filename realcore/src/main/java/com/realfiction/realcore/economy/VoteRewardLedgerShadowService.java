package com.realfiction.realcore.economy;

import com.realfiction.realcore.api.dto.RewardPayload;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.config.RewardEconomyConfig;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Logger;

/**
 * Phase 6C vote reward ledger shadowing.
 *
 * <p>This service intentionally has no API client and no economy writer. It can
 * only build and log the transaction RealCore would submit in a later phase.
 */
public final class VoteRewardLedgerShadowService {
  public static final String EXTERNAL_REF_TYPE = "reward_queue";
  public static final String SOURCE = "vote_reward_shadow";

  private final RealCoreConfig config;
  private final Logger logger;
  private final AtomicLong observedCount = new AtomicLong();
  private final AtomicBoolean anarchyWarningLogged = new AtomicBoolean(false);

  public VoteRewardLedgerShadowService(RealCoreConfig config, Logger logger) {
    this.config = config;
    this.logger = logger;
  }

  public Optional<EconomyTransaction> observe(RewardPayload reward) {
    if (reward == null || reward.rewardKey == null) {
      return Optional.empty();
    }
    RewardEconomyConfig.Mapping mapping = config.rewardEconomy().byRewardKey().get(reward.rewardKey);
    if (mapping == null || !enabled()) {
      return Optional.empty();
    }
    if ("anarchy".equalsIgnoreCase(config.serverGroup())) {
      if (anarchyWarningLogged.compareAndSet(false, true)) {
        logger.warning("Vote reward ledger shadow skipped: Anarchy is read-only for the global economy.");
      }
      return Optional.empty();
    }

    UUID uuid = parseUuid(reward.minecraftUuid());
    if (uuid == null) {
      logger.warning("Vote reward ledger shadow skipped; reward target has invalid UUID (rewardId=" + reward.id + ").");
      return Optional.empty();
    }

    EconomyTransaction transaction = EconomyTransaction.credit(
        uuid,
        reward.minecraftUsername(),
        mapping.amountMinor(),
        mapping.category(),
        "Vote reward ledger shadow: " + reward.rewardKey,
        idempotencyKey(reward.id, reward.rewardKey, mapping.currencyKey()),
        EXTERNAL_REF_TYPE,
        reward.id,
        metadata(reward, mapping)
    );
    observedCount.incrementAndGet();
    logger.info("Vote reward ledger shadow observed: rewardKey=" + reward.rewardKey
        + " rewardId=" + reward.id
        + " player=" + playerLabel(reward)
        + " amountMinor=" + mapping.amountMinor()
        + " currency=" + mapping.currencyKey()
        + " category=" + mapping.category().apiValue()
        + " idempotency=" + transaction.idempotencyKey()
        + " dryRun=true");
    return Optional.of(transaction);
  }

  public boolean enabled() {
    return !config.rewardEconomy().byRewardKey().isEmpty()
        && config.economy().voteRewardsToLedger();
  }

  public boolean configuredDryRun() {
    return config.economy().voteRewardsLedgerDryRun();
  }

  public boolean configuredLedgerWrites() {
    return config.economy().voteRewardsToLedger();
  }

  public long observedCount() {
    return observedCount.get();
  }

  public int mappingCount() {
    return config.rewardEconomy().byRewardKey().size();
  }

  public static String idempotencyKey(String rewardId, String rewardKey, String currencyKey) {
    return "reward:" + requireText(rewardId, "rewardId")
        + ":" + requireText(rewardKey, "rewardKey")
        + ":" + requireText(currencyKey, "currencyKey").toLowerCase(Locale.ROOT);
  }

  private Map<String, Object> metadata(RewardPayload reward, RewardEconomyConfig.Mapping mapping) {
    Map<String, Object> metadata = new LinkedHashMap<>();
    metadata.put("rewardId", reward.id);
    metadata.put("rewardKey", reward.rewardKey);
    metadata.put("minecraftUuid", reward.minecraftUuid());
    metadata.put("minecraftUsername", reward.minecraftUsername());
    metadata.put("serverId", config.serverId());
    metadata.put("serverGroup", config.serverGroup());
    metadata.put("dryRun", true);
    metadata.put("source", SOURCE);
    metadata.put("currencyKey", mapping.currencyKey());
    metadata.put("category", mapping.category().apiValue());
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

  private String playerLabel(RewardPayload reward) {
    String username = reward.minecraftUsername();
    if (username != null && !username.isBlank()) {
      return username;
    }
    String uuid = reward.minecraftUuid();
    return uuid == null || uuid.isBlank() ? "unknown" : uuid;
  }

  private static String requireText(String value, String field) {
    if (value == null || value.isBlank()) {
      throw new IllegalArgumentException(field + " is required");
    }
    return value.trim();
  }
}
