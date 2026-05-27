package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.util.UUID;
import java.util.logging.Logger;
import org.bukkit.entity.Player;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

final class GameplayEconomyTransactionBufferTest {
  private static final UUID PLAYER = UUID.fromString("00000000-0000-0000-0000-000000000123");

  private EconomyService economyService;
  private GameplayEconomyTransactionBuffer buffer;

  @BeforeEach
  void setUp() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            dryRun: true
            categories:
              gameplayEarn: true
              gameplaySpend: true
              shopSell: true
              shopBuy: true
        """);
    economyService = new EconomyService(
        config, new NoopScheduler(), new PlatformApiClient(config, Logger.getLogger("test")), Logger.getLogger("test"));
    economyService.start();
    buffer = new GameplayEconomyTransactionBuffer(config, economyService, Logger.getLogger("test"));
  }

  @Test
  void defaultsRejectWhenGameplaySyncDisabled() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
        """);
    GameplayEconomyTransactionBuffer disabled = new GameplayEconomyTransactionBuffer(
        config, economyService, Logger.getLogger("test"));

    GameplayEconomyTransactionBuffer.Result result = disabled.propose(proposal(100, GameplayEconomyCategory.GAMEPLAY_EARN));

    assertTrue(result.rejected());
    assertEquals("economy.gameplaySync.enabled is false", result.message());
    assertEquals(1, disabled.rejectedCount());
  }

  @Test
  void dryRunDoesNotCallWriter() {
    GameplayEconomyTransactionBuffer.Result result = buffer.propose(proposal(100, GameplayEconomyCategory.GAMEPLAY_EARN));

    assertTrue(result.dryRun());
    assertEquals(0, economyService.writer().queuedTransactionCount());
    assertEquals(1, buffer.dryRunCount());
    assertEquals(0, buffer.acceptedCount());
  }

  @Test
  void enabledWithoutDryRunEnqueuesWriter() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            dryRun: false
            categories:
              gameplayEarn: true
        """);
    EconomyService economy = new EconomyService(
        config, new NoopScheduler(), new PlatformApiClient(config, Logger.getLogger("test")), Logger.getLogger("test"));
    economy.start();
    GameplayEconomyTransactionBuffer live = new GameplayEconomyTransactionBuffer(config, economy, Logger.getLogger("test"));

    GameplayEconomyTransactionBuffer.Result result = live.propose(proposal(250, GameplayEconomyCategory.GAMEPLAY_EARN));

    assertTrue(result.accepted());
    assertEquals(1, economy.writer().queuedTransactionCount());
    assertEquals(1, live.acceptedCount());
  }

  @Test
  void anarchyIsRefused() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        server:
          id: "anarchy-1"
          group: "anarchy"
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            backendAllowlist:
              - anarchy-1
            categories:
              gameplayEarn: true
        """);
    GameplayEconomyTransactionBuffer anarchyBuffer = new GameplayEconomyTransactionBuffer(
        config, economyService, Logger.getLogger("test"));

    GameplayEconomyTransactionBuffer.Result result = anarchyBuffer.propose(proposal(100, GameplayEconomyCategory.GAMEPLAY_EARN));

    assertTrue(result.rejected());
    assertEquals("Anarchy may not mutate the global economy", result.message());
  }

  @Test
  void backendAllowlistRequired() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        server:
          id: "factions-1"
          group: "factions"
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            backendAllowlist:
              - smp-1
            categories:
              gameplayEarn: true
        """);
    GameplayEconomyTransactionBuffer factionsBuffer = new GameplayEconomyTransactionBuffer(
        config, economyService, Logger.getLogger("test"));

    GameplayEconomyTransactionBuffer.Result result = factionsBuffer.propose(proposal(100, GameplayEconomyCategory.GAMEPLAY_EARN));

    assertTrue(result.rejected());
    assertEquals("server.id is not in economy.gameplaySync.backendAllowlist", result.message());
  }

  @Test
  void disabledCategoryRejected() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            categories:
              gameplayEarn: false
              shopSell: true
        """);
    GameplayEconomyTransactionBuffer restricted = new GameplayEconomyTransactionBuffer(
        config, economyService, Logger.getLogger("test"));

    GameplayEconomyTransactionBuffer.Result result = restricted.propose(proposal(100, GameplayEconomyCategory.GAMEPLAY_EARN));

    assertTrue(result.rejected());
    assertTrue(result.message().contains("gameplay_earn"));
  }

  @Test
  void amountOverCapRejected() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            maxCreditMinorPerTx: 100
            categories:
              gameplayEarn: true
        """);
    GameplayEconomyTransactionBuffer capped = new GameplayEconomyTransactionBuffer(
        config, economyService, Logger.getLogger("test"));

    GameplayEconomyTransactionBuffer.Result result = capped.propose(proposal(101, GameplayEconomyCategory.GAMEPLAY_EARN));

    assertTrue(result.rejected());
    assertEquals("amountMinor exceeds economy.gameplaySync.maxCreditMinorPerTx", result.message());
  }

  @Test
  void zeroAmountRejected() {
    GameplayEconomyTransactionBuffer.Proposal proposal = new GameplayEconomyTransactionBuffer.Proposal(
        PLAYER, "Alex", 0, GameplayEconomyCategory.SHOP_BUY, "shop", "evt-1", "test");

    GameplayEconomyTransactionBuffer.Result result = buffer.propose(proposal);

    assertTrue(result.rejected());
    assertEquals("amountMinor must be greater than zero", result.message());
  }

  @Test
  void stableIdempotencyKeyGeneration() {
    String key = GameplayEconomyIdempotencyKeys.build(
        "smp-1",
        GameplayEconomyCategory.SHOP_SELL,
        "ShopGUI",
        PLAYER,
        "sale-42"
    );

    assertEquals("gameplay:smp-1:shop_sell:shopgui:" + PLAYER + ":sale-42", key);
  }

  @Test
  void countersUpdateOnMixedResults() throws InvalidConfigurationException {
    buffer.propose(proposal(100, GameplayEconomyCategory.GAMEPLAY_EARN));
    buffer.propose(proposal(0, GameplayEconomyCategory.GAMEPLAY_EARN));

    assertEquals(1, buffer.dryRunCount());
    assertEquals(1, buffer.rejectedCount());
    assertFalse(buffer.lastAcceptedMessage().isBlank());
    assertFalse(buffer.lastRejectedMessage().isBlank());
  }

  private static GameplayEconomyTransactionBuffer.Proposal proposal(long amount, GameplayEconomyCategory category) {
    return new GameplayEconomyTransactionBuffer.Proposal(
        PLAYER, "Alex", amount, category, "test-source", "event-1", "buffer test");
  }

  private static RealCoreConfig loadConfig(String yaml) throws InvalidConfigurationException {
    YamlConfiguration configuration = new YamlConfiguration();
    configuration.loadFromString("""
        baseUrl: "https://realfiction.test"
        server:
          id: "smp-1"
          group: "smp"
          displayName: "SMP 1"
        hmacSecret: "test-secret"
        """ + yaml);
    return RealCoreConfig.from(configuration);
  }

  private static final class NoopScheduler implements RealCoreScheduler {
    @Override public String name() { return "noop"; }
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
    @Override public java.util.concurrent.CompletableFuture<Void> dispatchConsoleCommand(String command) {
      return java.util.concurrent.CompletableFuture.completedFuture(null);
    }
    @Override public void close() {}
  }
}
