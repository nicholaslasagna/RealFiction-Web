package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
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

final class GenericGameplayEconomyProducerServiceTest {
  private static final UUID PLAYER = UUID.fromString("00000000-0000-0000-0000-000000000123");

  @Test
  void disabledByDefault() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
        """);
    assertFalse(config.economy().gameplaySync().generic().enabled());
    assertTrue(config.economy().gameplaySync().generic().dryRun());
    assertTrue(config.economy().gameplaySync().generic().allowedSources().isEmpty());
  }

  @Test
  void dryRunAcceptedDoesNotEnqueueWriter() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig(genericEnabledYaml(true, true, true, true, "RealCoreQuests"));
    GenericGameplayEconomyProducerService service = newService(config);
    GenericGameplayEconomyProducerService.SubmitResult result = service.submit(earnEvent("quest-1", 100));
    assertTrue(result.accepted());
    assertTrue(result.dryRun());
    assertEquals(1, service.metrics().dryRunCaptured());
    assertEquals(0, service.metrics().queued());
  }

  @Test
  void enabledLiveCallsBuffer() throws InvalidConfigurationException {
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
              gameplaySpend: false
            generic:
              enabled: true
              dryRun: false
              allowedSources:
                - RealCoreQuests
              allowGameplayEarn: true
              allowGameplaySpend: false
        """);
    EconomyService economy = new EconomyService(
        config, new NoopScheduler(), new PlatformApiClient(config, Logger.getLogger("test")), Logger.getLogger("test"));
    economy.start();
    GenericGameplayEconomyProducerService service = new GenericGameplayEconomyProducerService(
        config,
        new GameplayEconomyTransactionBuffer(config, economy, null, null, Logger.getLogger("test")),
        new GameplayEconomyIdempotencyDedupCache(Duration.ofMinutes(5), 1000),
        null,
        null,
        Logger.getLogger("test"));
    GenericGameplayEconomyProducerService.SubmitResult result = service.submit(earnEvent("quest-live", 50));
    assertTrue(result.accepted());
    assertFalse(result.dryRun());
    assertEquals(1, service.metrics().queued());
    assertTrue(economy.writer().queuedTransactionCount() > 0);
  }

  @Test
  void missingSourceRejected() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig(genericEnabledYaml(true, true, true, true, "RealCoreQuests"));
    GenericGameplayEconomyProducerService service = newService(config);
    GameplayEconomyEvent event = GameplayEconomyEvent.create(
        PLAYER, "Alex", 10, GameplayEconomyCategory.GAMEPLAY_EARN, "  ", "e1", "test");
    GenericGameplayEconomyProducerService.SubmitResult result = service.submit(event);
    assertFalse(result.accepted());
    assertTrue(service.metrics().rejected() > 0);
  }

  @Test
  void sourceNotAllowlistedRejected() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig(genericEnabledYaml(true, true, true, true, "RealCoreQuests"));
    GenericGameplayEconomyProducerService service = newService(config);
    GenericGameplayEconomyProducerService.SubmitResult result = service.submit(
        GameplayEconomyEvent.create(PLAYER, "Alex", 10, GameplayEconomyCategory.GAMEPLAY_EARN,
            "UnknownPlugin", "e2", "test"));
    assertFalse(result.accepted());
    assertTrue(service.metrics().rejected() > 0);
    assertTrue(service.metrics().lastRejectionReason().contains("allowedSources"));
  }

  @Test
  void gameplayEarnDisabledRejected() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            categories:
              gameplayEarn: true
            generic:
              enabled: true
              dryRun: true
              allowedSources:
                - RealCoreQuests
              allowGameplayEarn: false
              allowGameplaySpend: false
        """);
    GenericGameplayEconomyProducerService service = newService(config);
    assertFalse(service.submit(earnEvent("e3", 10)).accepted());
    assertTrue(service.metrics().rejected() > 0);
  }

  @Test
  void gameplaySpendDisabledRejected() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig(genericEnabledYaml(true, true, true, false, "GameplayFee"));
    GenericGameplayEconomyProducerService service = newService(config);
    GameplayEconomyEvent event = GameplayEconomyEvent.create(
        PLAYER, "Alex", 25, GameplayEconomyCategory.GAMEPLAY_SPEND, "GameplayFee", "fee-1", "entry");
    assertFalse(service.submit(event).accepted());
    assertTrue(service.metrics().rejected() > 0);
  }

  @Test
  void unsupportedShopCategoryRejectedAtConstruction() {
    assertThrows(IllegalArgumentException.class, () -> GameplayEconomyEvent.create(
        PLAYER, "Alex", 10, GameplayEconomyCategory.SHOP_SELL, "EconomyShopGUI", "s1", "sell"));
    assertThrows(IllegalArgumentException.class, () -> GameplayEconomyEvent.create(
        PLAYER, "Alex", 10, GameplayEconomyCategory.SHOP_BUY, "EconomyShopGUI", "b1", "buy"));
  }

  @Test
  void overCapRejected() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            categories:
              gameplayEarn: true
            generic:
              enabled: true
              dryRun: true
              allowedSources:
                - RealCoreQuests
              allowGameplayEarn: true
              maxCreditMinorPerEvent: 50
        """);
    GenericGameplayEconomyProducerService service = newService(config);
    assertFalse(service.submit(earnEvent("big", 500)).accepted());
    assertEquals(1, service.metrics().overCapRejected());
  }

  @Test
  void anarchyRejected() throws InvalidConfigurationException {
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
            generic:
              enabled: true
              dryRun: true
              allowedSources:
                - RealCoreQuests
              allowGameplayEarn: true
            categories:
              gameplayEarn: true
        """);
    GenericGameplayEconomyProducerService service = newService(config);
    assertFalse(service.submit(earnEvent("e4", 10)).accepted());
    assertTrue(service.metrics().rejected() > 0);
  }

  @Test
  void stableIdempotencyKey() {
    String key = GameplayEconomyIdempotencyKeys.build(
        "smp-1",
        GameplayEconomyCategory.GAMEPLAY_EARN,
        "RealCoreQuests",
        PLAYER,
        "quest-99"
    );
    assertEquals("gameplay:smp-1:gameplay_earn:realcorequests:" + PLAYER + ":quest-99", key);
  }

  @Test
  void duplicateSubmissionRejected() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig(genericEnabledYaml(true, true, true, true, "RealCoreQuests"));
    GenericGameplayEconomyProducerService service = newService(config);
    GameplayEconomyEvent event = earnEvent("dup-1", 10);
    assertTrue(service.submit(event).accepted());
    assertFalse(service.submit(event).accepted());
    assertEquals(1, service.metrics().duplicateRejected());
  }

  private static GameplayEconomyEvent earnEvent(String eventId, long amountMinor) {
    return GameplayEconomyEvent.create(
        PLAYER, "Alex", amountMinor, GameplayEconomyCategory.GAMEPLAY_EARN, "RealCoreQuests", eventId, "quest reward");
  }

  private static String genericEnabledYaml(
      boolean genericDryRun,
      boolean allowEarn,
      boolean categoryEarn,
      boolean allowSpend,
      String allowedSource
  ) {
    return """
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            dryRun: true
            categories:
              gameplayEarn: %s
              gameplaySpend: false
            generic:
              enabled: true
              dryRun: %s
              allowedSources:
                - %s
              allowGameplayEarn: %s
              allowGameplaySpend: %s
        """.formatted(categoryEarn, genericDryRun, allowedSource, allowEarn, allowSpend);
  }

  private static GenericGameplayEconomyProducerService newService(RealCoreConfig config) {
    EconomyService economy = new EconomyService(
        config, new NoopScheduler(), new PlatformApiClient(config, Logger.getLogger("test")), Logger.getLogger("test"));
    economy.start();
    return new GenericGameplayEconomyProducerService(
        config,
        new GameplayEconomyTransactionBuffer(config, economy, null, null, Logger.getLogger("test")),
        new GameplayEconomyIdempotencyDedupCache(Duration.ofMinutes(5), 1000),
        null,
        null,
        Logger.getLogger("test"));
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
