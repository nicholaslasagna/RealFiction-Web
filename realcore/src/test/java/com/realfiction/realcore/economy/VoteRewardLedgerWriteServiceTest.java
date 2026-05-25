package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.api.dto.EconomyTransactionsRequest;
import com.realfiction.realcore.api.dto.EconomyTransactionsResponse;
import com.realfiction.realcore.api.dto.RewardPayload;
import com.realfiction.realcore.config.RealCoreConfig;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Logger;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class VoteRewardLedgerWriteServiceTest {
  @Test
  void buildsRequiredVoteRewardTransactionFields() throws InvalidConfigurationException {
    VoteRewardLedgerWriteService service = new VoteRewardLedgerWriteService(
        config("smp", true, true, true, true),
        request -> CompletableFuture.completedFuture(success(1, 0, false)),
        Logger.getLogger("test")
    );

    EconomyTransaction transaction = service.transactionFor(reward());

    assertEquals(25000, transaction.amountMinor());
    assertEquals(EconomyCategory.VOTE_REWARD, transaction.category());
    assertEquals("reward:reward-123:vote.standard:realfiction_main", transaction.idempotencyKey());
    assertEquals(VoteRewardLedgerWriteService.EXTERNAL_REF_TYPE, transaction.externalRefType());
    assertEquals("reward-123", transaction.externalRefId());
    assertEquals("reward-123", transaction.metadata().get("rewardId"));
    assertEquals("vote.standard", transaction.metadata().get("rewardKey"));
    assertEquals("smp-1", transaction.metadata().get("serverId"));
    assertEquals("smp", transaction.metadata().get("serverGroup"));
    assertEquals(VoteRewardLedgerWriteService.SOURCE, transaction.metadata().get("source"));
  }

  @Test
  void duplicateApiResultIsDeliverySuccessAndSkipsFailureCounter() throws InvalidConfigurationException {
    RecordingTransport transport = new RecordingTransport(success(0, 1, false));
    VoteRewardLedgerWriteService service = new VoteRewardLedgerWriteService(
        config("smp", true, true, true, true), transport, Logger.getLogger("test"));

    VoteRewardLedgerWriteService.WriteResult result = service.write(reward()).join();

    assertTrue(result.delivered());
    assertTrue(result.duplicate());
    assertEquals(1, service.duplicateSuccessCount());
    assertEquals(0, service.failureCount());
    assertEquals(1, transport.requests.size());
    EconomyTransactionsRequest request = transport.requests.get(0);
    assertEquals("realfiction_main", request.currencyKey);
    assertEquals("reward:reward-123:vote.standard:realfiction_main", request.transactions.get(0).idempotencyKey);
  }

  @Test
  void anarchyRefusesBeforeApiCall() throws InvalidConfigurationException {
    RecordingTransport transport = new RecordingTransport(success(1, 0, false));
    VoteRewardLedgerWriteService service = new VoteRewardLedgerWriteService(
        config("anarchy", true, true, true, true), transport, Logger.getLogger("test"));

    VoteRewardLedgerWriteService.WriteResult result = service.write(reward()).join();

    assertFalse(result.delivered());
    assertEquals(1, service.failureCount());
    assertEquals(0, transport.requests.size());
  }

  private static RealCoreConfig config(String serverGroup, boolean economyEnabled, boolean moduleEconomy,
                                       boolean writesEnabled, boolean fallbackCommands)
      throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        baseUrl: "https://realfiction.test"
        server:
          id: "%s-1"
          group: "%s"
          displayName: "Test"
        hmacSecret: "test-secret"
        modules:
          economy: %s
        economy:
          enabled: %s
          currencyKey: "realfiction_main"
          voteRewardsLedgerWritesEnabled: %s
          voteRewardsLedgerFallbackCommands: %s
        rewards:
          economy:
            byRewardKey:
              vote.standard:
                amountMinor: 25000
                currencyKey: "realfiction_main"
                category: vote_reward
        """.formatted(serverGroup, serverGroup, moduleEconomy, economyEnabled, writesEnabled, fallbackCommands));
    return RealCoreConfig.from(yaml);
  }

  private static RewardPayload reward() {
    RewardPayload reward = new RewardPayload();
    reward.id = "reward-123";
    reward.rewardKey = "vote.standard";
    reward.target = new RewardPayload.Target();
    reward.target.minecraftUuid = "11111111-1111-1111-1111-111111111111";
    reward.target.minecraftUsername = "Alex";
    reward.delivery = new RewardPayload.Delivery();
    reward.delivery.safeReward = true;
    reward.delivery.voteSite = "TestVote";
    return reward;
  }

  private static EconomyTransactionsResponse success(int applied, int duplicates, boolean duplicateBatch) {
    EconomyTransactionsResponse response = new EconomyTransactionsResponse();
    response.ok = true;
    response.applied = applied;
    response.duplicates = duplicates;
    response.duplicateBatch = duplicateBatch;
    return response;
  }

  private static final class RecordingTransport implements EconomyTransactionsTransport {
    private final List<EconomyTransactionsRequest> requests = new ArrayList<>();
    private final AtomicReference<EconomyTransactionsResponse> response;

    private RecordingTransport(EconomyTransactionsResponse response) {
      this.response = new AtomicReference<>(response);
    }

    @Override
    public CompletableFuture<EconomyTransactionsResponse> send(EconomyTransactionsRequest request) {
      requests.add(request);
      return CompletableFuture.completedFuture(response.get());
    }
  }
}
