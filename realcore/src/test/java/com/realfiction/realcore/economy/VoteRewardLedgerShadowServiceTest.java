package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.api.dto.RewardPayload;
import com.realfiction.realcore.config.RealCoreConfig;
import java.util.Optional;
import java.util.UUID;
import java.util.logging.Logger;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class VoteRewardLedgerShadowServiceTest {
  private static final String PLAYER_UUID = "00000000-0000-0000-0000-000000000123";

  @Test
  void mapsVoteRewardToDryRunTransaction() throws InvalidConfigurationException {
    RealCoreConfig config = config("lobby", true, true);
    VoteRewardLedgerShadowService service = new VoteRewardLedgerShadowService(config, Logger.getLogger("test"));

    Optional<EconomyTransaction> observed = service.observe(reward("reward-123", "vote.standard"));

    assertTrue(observed.isPresent());
    EconomyTransaction transaction = observed.orElseThrow();
    assertEquals(UUID.fromString(PLAYER_UUID), transaction.minecraftUuid());
    assertEquals("LittleNicholas", transaction.minecraftUsername());
    assertEquals(25000, transaction.amountMinor());
    assertEquals(EconomyCategory.VOTE_REWARD, transaction.category());
    assertEquals("reward:reward-123:vote.standard:realfiction_main", transaction.idempotencyKey());
    assertEquals(VoteRewardLedgerShadowService.EXTERNAL_REF_TYPE, transaction.externalRefType());
    assertEquals("reward-123", transaction.externalRefId());
    assertEquals("reward-123", transaction.metadata().get("rewardId"));
    assertEquals("vote.standard", transaction.metadata().get("rewardKey"));
    assertEquals(PLAYER_UUID, transaction.metadata().get("minecraftUuid"));
    assertEquals("LittleNicholas", transaction.metadata().get("minecraftUsername"));
    assertEquals("lobby-1", transaction.metadata().get("serverId"));
    assertEquals("lobby", transaction.metadata().get("serverGroup"));
    assertEquals(true, transaction.metadata().get("dryRun"));
    assertEquals(VoteRewardLedgerShadowService.SOURCE, transaction.metadata().get("source"));
    assertEquals(1, service.observedCount());
  }

  @Test
  void idempotencyKeyIsStable() {
    String first = VoteRewardLedgerShadowService.idempotencyKey("reward-123", "vote.standard", "realfiction_main");
    String second = VoteRewardLedgerShadowService.idempotencyKey("reward-123", "vote.standard", "realfiction_main");

    assertEquals(first, second);
  }

  @Test
  void anarchyRefusesShadowMapping() throws InvalidConfigurationException {
    VoteRewardLedgerShadowService service =
        new VoteRewardLedgerShadowService(config("anarchy", true, true), Logger.getLogger("test"));

    assertFalse(service.observe(reward("reward-123", "vote.standard")).isPresent());
    assertEquals(0, service.observedCount());
  }

  @Test
  void disabledFlagsDoNotObserve() throws InvalidConfigurationException {
    VoteRewardLedgerShadowService service =
        new VoteRewardLedgerShadowService(config("lobby", false, true), Logger.getLogger("test"));

    assertFalse(service.enabled());
    assertFalse(service.observe(reward("reward-123", "vote.standard")).isPresent());
    assertEquals(0, service.observedCount());
  }

  @Test
  void unknownRewardKeyDoesNotObserve() throws InvalidConfigurationException {
    VoteRewardLedgerShadowService service =
        new VoteRewardLedgerShadowService(config("lobby", true, true), Logger.getLogger("test"));

    assertFalse(service.observe(reward("reward-123", "store.cosmetic")).isPresent());
    assertEquals(0, service.observedCount());
  }

  private static RewardPayload reward(String rewardId, String rewardKey) {
    RewardPayload reward = new RewardPayload();
    reward.id = rewardId;
    reward.rewardKey = rewardKey;
    reward.target = new RewardPayload.Target();
    reward.target.minecraftUuid = PLAYER_UUID;
    reward.target.minecraftUsername = "LittleNicholas";
    reward.delivery = new RewardPayload.Delivery();
    reward.delivery.safeReward = true;
    reward.delivery.voteSite = "mclist.io";
    return reward;
  }

  private static RealCoreConfig config(String serverGroup, boolean voteRewardsToLedger, boolean dryRun)
      throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        baseUrl: "https://realfiction.test"
        server:
          id: "lobby-1"
          group: "%s"
          displayName: "Lobby 1"
        hmacSecret: "secret"
        economy:
          voteRewardsToLedger: %s
          voteRewardsLedgerDryRun: %s
        rewards:
          economy:
            byRewardKey:
              vote.standard:
                amountMinor: 25000
                currencyKey: realfiction_main
                category: vote_reward
        """.formatted(serverGroup, voteRewardsToLedger, dryRun));
    return RealCoreConfig.from(yaml);
  }
}
