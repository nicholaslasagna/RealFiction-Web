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
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;

final class GameplayEconomyLiveGateTest {
  private static final UUID PLAYER = UUID.fromString("00000000-0000-0000-0000-000000000123");

  @Test
  void singleFlagGameplaySyncEnabledStillDryRunsInBuffer() throws InvalidConfigurationException {
    RealCoreConfig config = load("""
        server:
          id: smp-1
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            dryRun: true
            categories:
              shopSell: true
        """);
    GameplayEconomyTransactionBuffer buffer = buffer(config);
    GameplayEconomyTransactionBuffer.Result result = buffer.propose(proposal());
    assertTrue(result.dryRun());
    assertFalse(result.accepted());
    assertEquals(0, buffer.writerQueuedCount());
  }

  @Test
  void allLiveFlagsExceptGlobalDryRunStillDoesNotEnqueue() throws InvalidConfigurationException {
    RealCoreConfig config = load("""
        server:
          id: smp-1
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            dryRun: true
            categories:
              shopSell: true
            producers:
              economyShopGuiSell:
                enabled: true
                dryRun: false
        """);
    GameplayEconomyCaptureService capture = capture(config);
    capture.capture(new GameplayEconomyCaptureService.CaptureRequest(
        "economyShopGuiSell",
        config.economy().gameplaySync().producers().economyShopGuiSell(),
        PLAYER,
        "Alex",
        100,
        "EconomyShopGUI",
        "event-1",
        "test"
    ));
    assertEquals(1, capture.metrics().dryRunCaptured());
    assertEquals(0, capture.metrics().queued());
  }

  @Test
  void liveGameplaySyncWithoutEconomyEnabledRejects() throws InvalidConfigurationException {
    RealCoreConfig config = load("""
        server:
          id: smp-1
        modules:
          economy: true
        economy:
          enabled: false
          gameplaySync:
            enabled: true
            dryRun: false
            categories:
              shopSell: true
        """);
    GameplayEconomyTransactionBuffer buffer = buffer(config);
    GameplayEconomyTransactionBuffer.Result result = buffer.propose(proposal());
    assertTrue(result.rejected());
  }

  private static GameplayEconomyTransactionBuffer.Proposal proposal() {
    return new GameplayEconomyTransactionBuffer.Proposal(
        PLAYER,
        "Alex",
        100,
        GameplayEconomyCategory.SHOP_SELL,
        "test",
        "event-1",
        "live-gate-test"
    );
  }

  private static GameplayEconomyCaptureService capture(RealCoreConfig config) throws InvalidConfigurationException {
    EconomyService economy = economy(config);
    return new GameplayEconomyCaptureService(
        config,
        buffer(config),
        new GameplayEconomyIdempotencyDedupCache(
            config.economy().gameplaySync().producers().dedupCacheTtl(),
            config.economy().gameplaySync().producers().dedupCacheMaxEntries()),
        new GameplayEconomyProducerMetricsRegistry(),
        null,
        null,
        Logger.getLogger("test"));
  }

  private static GameplayEconomyTransactionBuffer buffer(RealCoreConfig config) throws InvalidConfigurationException {
    return new GameplayEconomyTransactionBuffer(config, economy(config), null, null, Logger.getLogger("test"));
  }

  private static EconomyService economy(RealCoreConfig config) {
    EconomyService service = new EconomyService(
        config, new NoopScheduler(), new PlatformApiClient(config, Logger.getLogger("test")), Logger.getLogger("test"));
    service.start();
    return service;
  }

  private static RealCoreConfig load(String yaml) throws InvalidConfigurationException {
    YamlConfiguration configuration = new YamlConfiguration();
    configuration.loadFromString(yaml);
    configuration.set("baseUrl", "https://realfiction.live");
    configuration.set("hmacSecret", "test-secret");
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
