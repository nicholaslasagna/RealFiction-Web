package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.time.Duration;
import java.util.UUID;
import java.util.logging.Logger;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;

final class GameplayEconomySimulatorServiceTest {
  private static final UUID PLAYER = UUID.fromString("00000000-0000-0000-0000-000000000456");

  @Test
  void disabledGenericRejects() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            generic:
              enabled: false
        """);
    GenericGameplayEconomyProducerService producer = newProducer(config);
    GameplayEconomySimulatorService.SimulateResponse response = simulateEarn(
        config, producer, "manual_simulator", "evt-1", 10);
    assertFalse(response.accepted());
    assertNotNull(response.rejectionReason());
    assertTrue(response.rejectionReason().contains("generic.enabled"));
  }

  @Test
  void sourceAllowlistRejects() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig(simulatorYaml(true, true, true));
    GenericGameplayEconomyProducerService producer = newProducer(config);
    GameplayEconomySimulatorService.SimulateResponse response = simulateEarn(
        config, producer, "not_allowlisted", "evt-2", 10);
    assertFalse(response.accepted());
    assertTrue(response.rejectionReason().contains("allowedSources"));
  }

  @Test
  void dryRunAcceptedDoesNotEnqueueWriter() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig(simulatorYaml(true, true, true));
    EconomyService economy = newEconomy(config);
    GenericGameplayEconomyProducerService producer = newProducer(config, economy);
    GameplayEconomySimulatorService.SimulateResponse response = simulateEarn(
        config, producer, "manual_simulator", "evt-3", 25);
    assertTrue(response.accepted());
    assertTrue(response.dryRun());
    assertEquals(1, producer.metrics().dryRunCaptured());
    assertEquals(0, producer.metrics().queued());
    assertEquals(0, economy.writer().queuedTransactionCount());
  }

  @Test
  void earnMapsToGameplayEarn() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig(simulatorYaml(true, true, false));
    GenericGameplayEconomyProducerService producer = newProducer(config);
    GameplayEconomySimulatorService.SimulateResponse response = simulate(
        config, producer, "earn", "manual_simulator", "evt-earn", 15);
    assertTrue(response.accepted());
    assertEquals(GameplayEconomyCategory.GAMEPLAY_EARN, response.category());
    assertEquals("gameplay_earn", response.category().ledgerCategory().apiValue());
  }

  @Test
  void spendMapsToGameplaySpend() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig(simulatorYaml(false, true, true));
    GenericGameplayEconomyProducerService producer = newProducer(config);
    GameplayEconomySimulatorService.SimulateResponse response = simulate(
        config, producer, "spend", "manual_simulator", "evt-spend", 20);
    assertTrue(response.accepted());
    assertEquals(GameplayEconomyCategory.GAMEPLAY_SPEND, response.category());
    assertEquals("gameplay_spend", response.category().ledgerCategory().apiValue());
  }

  @Test
  void invalidAmountRejected() {
    assertNull(GameplayEconomySimulatorService.parsePositiveAmount("0"));
    assertNull(GameplayEconomySimulatorService.parsePositiveAmount("-5"));
    assertNull(GameplayEconomySimulatorService.parsePositiveAmount("1.5"));
    assertNull(GameplayEconomySimulatorService.parsePositiveAmount(""));
  }

  @Test
  void unsupportedCategoryRejected() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig(simulatorYaml(true, true, true));
    GenericGameplayEconomyProducerService producer = newProducer(config);
    GameplayEconomySimulatorService.SimulateResponse response = simulate(
        config, producer, "shop_sell", "manual_simulator", "evt-bad", 10);
    assertFalse(response.accepted());
    assertEquals("kind must be earn or spend", response.rejectionReason());
    assertEquals(0, producer.metrics().captured());
  }

  @Test
  void duplicateEventIdSuppressed() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig(simulatorYaml(true, true, true));
    GenericGameplayEconomyProducerService producer = newProducer(config);
    assertTrue(simulateEarn(config, producer, "manual_simulator", "dup-evt", 5).accepted());
    GameplayEconomySimulatorService.SimulateResponse second = simulateEarn(
        config, producer, "manual_simulator", "dup-evt", 5);
    assertFalse(second.accepted());
    assertEquals("duplicate event", second.rejectionReason());
    assertEquals(1, producer.metrics().duplicateRejected());
  }

  @Test
  void doesNotUseVoteRewardCategoryOrSource() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig(simulatorYaml(true, true, true));
    GenericGameplayEconomyProducerService producer = newProducer(config);
    GameplayEconomySimulatorService.SimulateResponse response = simulateEarn(
        config, producer, "manual_simulator", "evt-vote-guard", 10);
    assertTrue(response.accepted());
    assertEquals("manual_simulator", response.source());
    assertEquals(GameplayEconomyCategory.GAMEPLAY_EARN, response.category());
    assertFalse(response.source().contains("vote"));
    assertNotNull(response.idempotencyKey());
    assertTrue(response.idempotencyKey().contains("gameplay_earn"));
    assertFalse(response.idempotencyKey().contains("vote_reward"));
  }

  @Test
  void idempotencyKeyPrintedOnSuccess() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig(simulatorYaml(true, true, true));
    GenericGameplayEconomyProducerService producer = newProducer(config);
    GameplayEconomySimulatorService.SimulateResponse response = simulateEarn(
        config, producer, "manual_simulator", "evt-key", 10);
    assertEquals(
        "gameplay:smp-1:gameplay_earn:manual_simulator:" + PLAYER + ":evt-key",
        response.idempotencyKey()
    );
  }

  private static GameplayEconomySimulatorService.SimulateResponse simulateEarn(
      RealCoreConfig config,
      GenericGameplayEconomyProducerService producer,
      String source,
      String eventId,
      long amountMinor
  ) {
    return simulate(config, producer, "earn", source, eventId, amountMinor);
  }

  private static GameplayEconomySimulatorService.SimulateResponse simulate(
      RealCoreConfig config,
      GenericGameplayEconomyProducerService producer,
      String kind,
      String source,
      String eventId,
      long amountMinor
  ) {
    return GameplayEconomySimulatorService.simulate(
        config,
        producer,
        new GameplayEconomySimulatorService.SimulateRequest(
            kind, PLAYER, "Alex", amountMinor, source, eventId));
  }

  private static String simulatorYaml(boolean allowEarn, boolean allowSpend, boolean spendCategory) {
    return """
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            dryRun: true
            categories:
              gameplayEarn: true
              gameplaySpend: %s
            generic:
              enabled: true
              dryRun: true
              allowedSources:
                - manual_simulator
              allowGameplayEarn: %s
              allowGameplaySpend: %s
              logEvents: true
        """.formatted(spendCategory, allowEarn, allowSpend);
  }

  private static GenericGameplayEconomyProducerService newProducer(RealCoreConfig config) {
    return newProducer(config, newEconomy(config));
  }

  private static GenericGameplayEconomyProducerService newProducer(RealCoreConfig config, EconomyService economy) {
    return new GenericGameplayEconomyProducerService(
        config,
        new GameplayEconomyTransactionBuffer(config, economy, null, null, Logger.getLogger("test")),
        new GameplayEconomyIdempotencyDedupCache(Duration.ofMinutes(5), 1000),
        null,
        null,
        Logger.getLogger("test"));
  }

  private static EconomyService newEconomy(RealCoreConfig config) {
    EconomyService economy = new EconomyService(
        config, new NoopScheduler(), new PlatformApiClient(config, Logger.getLogger("test")), Logger.getLogger("test"));
    economy.start();
    return economy;
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
