package com.realfiction.realcore.rewards;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.api.dto.EconomyTransactionsRequest;
import com.realfiction.realcore.api.dto.EconomyTransactionsResponse;
import com.realfiction.realcore.api.dto.RewardPayload;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.economy.EconomyTransactionsTransport;
import com.realfiction.realcore.economy.VoteRewardLedgerWriteService;
import com.realfiction.realcore.luckperms.LuckPermsService;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Logger;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;

final class RewardDispatcherLedgerWriteTest {
  @Test
  void defaultsPreserveCurrentCommandBehavior() throws InvalidConfigurationException {
    Fixture fixture = fixture(config("smp", true, true, null, null), success(1, 0, false));

    RewardDeliveryResult result = fixture.dispatcher.dispatch(reward()).join();

    assertTrue(result.delivered());
    assertEquals(List.of("eco give Alex 250"), fixture.scheduler.commands);
    assertEquals(0, fixture.transport.requests.size());
  }

  @Test
  void writesDisabledRunsExistingCommands() throws InvalidConfigurationException {
    Fixture fixture = fixture(config("smp", true, true, false, true), success(1, 0, false));

    RewardDeliveryResult result = fixture.dispatcher.dispatch(reward()).join();

    assertTrue(result.delivered());
    assertEquals(List.of("eco give Alex 250"), fixture.scheduler.commands);
    assertEquals(0, fixture.transport.requests.size());
  }

  @Test
  void writesEnabledSuccessSkipsEcoGiveAndDelivers() throws InvalidConfigurationException {
    Fixture fixture = fixture(config("smp", true, true, true, true), success(1, 0, false));

    RewardDeliveryResult result = fixture.dispatcher.dispatch(reward()).join();

    assertTrue(result.delivered());
    assertEquals(List.of(), fixture.scheduler.commands);
    assertEquals(1, fixture.transport.requests.size());
    assertEquals(1, fixture.writer.successCount());
  }

  @Test
  void duplicateSuccessSkipsEcoGiveAndDelivers() throws InvalidConfigurationException {
    Fixture fixture = fixture(config("smp", true, true, true, true), success(0, 1, false));

    RewardDeliveryResult result = fixture.dispatcher.dispatch(reward()).join();

    assertTrue(result.delivered());
    assertEquals(List.of(), fixture.scheduler.commands);
    assertEquals(1, fixture.transport.requests.size());
    assertEquals(1, fixture.writer.duplicateSuccessCount());
  }

  @Test
  void failureWithFallbackEnabledRunsCommandsAndDelivers() throws InvalidConfigurationException {
    Fixture fixture = fixture(config("smp", true, true, true, true), failed());

    RewardDeliveryResult result = fixture.dispatcher.dispatch(reward()).join();

    assertTrue(result.delivered());
    assertEquals(List.of("eco give Alex 250"), fixture.scheduler.commands);
    assertEquals(1, fixture.writer.failureCount());
    assertEquals(1, fixture.writer.fallbackCount());
  }

  @Test
  void failureWithFallbackDisabledDoesNotDeliverOrAck() throws InvalidConfigurationException {
    Fixture fixture = fixture(config("smp", true, true, true, false), failed());

    RewardDeliveryResult result = fixture.dispatcher.dispatch(reward()).join();

    assertFalse(result.delivered());
    assertEquals(List.of(), fixture.scheduler.commands);
    assertEquals(1, fixture.writer.failureCount());
    assertEquals(0, fixture.writer.fallbackCount());
  }

  @Test
  void anarchyRefusesBeforeApiCallAndUsesFallbackPolicy() throws InvalidConfigurationException {
    Fixture fixture = fixture(config("anarchy", true, true, true, true), success(1, 0, false));

    RewardDeliveryResult result = fixture.dispatcher.dispatch(reward()).join();

    assertTrue(result.delivered());
    assertEquals(List.of("eco give Alex 250"), fixture.scheduler.commands);
    assertEquals(0, fixture.transport.requests.size());
    assertEquals(1, fixture.writer.fallbackCount());
  }

  @Test
  void economyDisabledPreventsLedgerWriteAndUsesFallbackPolicy() throws InvalidConfigurationException {
    Fixture fixture = fixture(config("smp", false, true, true, true), success(1, 0, false));

    RewardDeliveryResult result = fixture.dispatcher.dispatch(reward()).join();

    assertTrue(result.delivered());
    assertEquals(List.of("eco give Alex 250"), fixture.scheduler.commands);
    assertEquals(0, fixture.transport.requests.size());
    assertEquals(1, fixture.writer.fallbackCount());
  }

  @Test
  void economyModuleDisabledPreventsLedgerWriteAndUsesFallbackPolicy() throws InvalidConfigurationException {
    Fixture fixture = fixture(config("smp", true, false, true, true), success(1, 0, false));

    RewardDeliveryResult result = fixture.dispatcher.dispatch(reward()).join();

    assertTrue(result.delivered());
    assertEquals(List.of("eco give Alex 250"), fixture.scheduler.commands);
    assertEquals(0, fixture.transport.requests.size());
    assertEquals(1, fixture.writer.fallbackCount());
  }

  private static Fixture fixture(RealCoreConfig config, CompletableFuture<EconomyTransactionsResponse> response) {
    RecordingScheduler scheduler = new RecordingScheduler();
    RecordingTransport transport = new RecordingTransport(response);
    VoteRewardLedgerWriteService writer = new VoteRewardLedgerWriteService(config, transport, Logger.getLogger("test"));
    RewardDispatcher dispatcher = new RewardDispatcher(
        Logger.getLogger("test"), config, scheduler, new NoopLuckPerms(), null, writer);
    return new Fixture(dispatcher, scheduler, transport, writer);
  }

  private static RealCoreConfig config(String serverGroup, boolean economyEnabled, boolean moduleEconomy,
                                       Boolean writesEnabled, Boolean fallbackCommands)
      throws InvalidConfigurationException {
    String writeFlag = writesEnabled == null ? "" : "          voteRewardsLedgerWritesEnabled: " + writesEnabled + "\n";
    String fallbackFlag = fallbackCommands == null ? "" : "          voteRewardsLedgerFallbackCommands: " + fallbackCommands + "\n";
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
%s%s        rewards:
          commands:
            byRewardKey:
              vote.standard:
                - "eco give {player} 250"
          economy:
            byRewardKey:
              vote.standard:
                amountMinor: 25000
                currencyKey: "realfiction_main"
                category: vote_reward
        """.formatted(serverGroup, serverGroup, moduleEconomy, economyEnabled, writeFlag, fallbackFlag));
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
    reward.delivery.quantity = 1;
    return reward;
  }

  private static CompletableFuture<EconomyTransactionsResponse> success(int applied, int duplicates, boolean duplicateBatch) {
    EconomyTransactionsResponse response = new EconomyTransactionsResponse();
    response.ok = true;
    response.applied = applied;
    response.duplicates = duplicates;
    response.duplicateBatch = duplicateBatch;
    return CompletableFuture.completedFuture(response);
  }

  private static CompletableFuture<EconomyTransactionsResponse> failed() {
    CompletableFuture<EconomyTransactionsResponse> response = new CompletableFuture<>();
    response.completeExceptionally(new RuntimeException("api unavailable"));
    return response;
  }

  private record Fixture(RewardDispatcher dispatcher, RecordingScheduler scheduler,
                         RecordingTransport transport, VoteRewardLedgerWriteService writer) {}

  private static final class RecordingTransport implements EconomyTransactionsTransport {
    private final AtomicReference<CompletableFuture<EconomyTransactionsResponse>> response;
    private final List<EconomyTransactionsRequest> requests = new ArrayList<>();

    private RecordingTransport(CompletableFuture<EconomyTransactionsResponse> response) {
      this.response = new AtomicReference<>(response);
    }

    @Override
    public CompletableFuture<EconomyTransactionsResponse> send(EconomyTransactionsRequest request) {
      requests.add(request);
      return response.get();
    }
  }

  private static final class RecordingScheduler implements RealCoreScheduler {
    private final List<String> commands = new ArrayList<>();

    @Override public String name() { return "test"; }
    @Override public boolean folia() { return false; }
    @Override public void runAsync(Runnable task) { task.run(); }
    @Override public ScheduledTaskHandle runAsyncRepeating(Runnable task, long initialDelaySeconds, long periodSeconds) {
      return () -> {};
    }
    @Override public ScheduledTaskHandle runGlobalRepeating(Runnable task, long initialDelayTicks, long periodTicks) {
      return () -> {};
    }
    @Override public void runGlobal(Runnable task) { task.run(); }
    @Override public void runForPlayer(Player player, Runnable task) { task.run(); }
    @Override public void runForPlayerLater(Player player, Runnable task, long delayTicks) { task.run(); }
    @Override public CompletableFuture<Void> dispatchConsoleCommand(String command) {
      commands.add(command);
      return CompletableFuture.completedFuture(null);
    }
    @Override public void send(CommandSender sender, String message) {}
    @Override public void close() {}
  }

  private static final class NoopLuckPerms implements LuckPermsService {
    @Override public boolean available() { return true; }
    @Override public CompletableFuture<Void> apply(RewardPayload reward) { return CompletableFuture.completedFuture(null); }
    @Override public CompletableFuture<Void> grantPermission(UUID uuid, String permission, Duration duration) {
      return CompletableFuture.completedFuture(null);
    }
    @Override public CompletableFuture<Void> revokePermission(UUID uuid, String permission) {
      return CompletableFuture.completedFuture(null);
    }
  }
}
