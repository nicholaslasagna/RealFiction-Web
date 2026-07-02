package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
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

final class GameplayCreditServiceTest {
  private static final UUID PLAYER = UUID.fromString("00000000-0000-0000-0000-000000000777");

  @Test
  void rejectsNonPositiveAndOverCapAmounts() throws InvalidConfigurationException {
    Fixture fixture = lobbyFixture(true, "lobby_parkour", 50_000);
    assertRejected(credit(fixture, 0, "lobby_parkour", "parkour_test", "e1"), "positive");
    assertRejected(credit(fixture, -5, "lobby_parkour", "parkour_test", "e2"), "positive");
    assertRejected(credit(fixture, 50_001, "lobby_parkour", "parkour_test", "e3"), "maxCreditMinorPerTx");
    assertEquals(0, fixture.producer.metrics().captured());
  }

  @Test
  void rejectsUnsafeSourceReasonAndPlayer() throws InvalidConfigurationException {
    Fixture fixture = lobbyFixture(true, "lobby_parkour", 50_000);
    assertRejected(credit(fixture, 100, "lobby parkour", "parkour_test", "e1"), "source");
    assertRejected(credit(fixture, 100, "LOBBY_PARKOUR", "parkour_test", "e2"), "source");
    assertRejected(credit(fixture, 100, "lobby_parkour", "bad reason with spaces", "e3"), "reason");
    assertRejected(credit(fixture, 100, "lobby_parkour", "x".repeat(81), "e4"), "reason");
    assertRejected(
        GameplayCreditService.credit(fixture.config, fixture.producer,
            new GameplayCreditService.CreditRequest(PLAYER, "not a name!", 100, "lobby_parkour", "ok", "e5")),
        "username");
    assertRejected(
        GameplayCreditService.credit(fixture.config, fixture.producer,
            new GameplayCreditService.CreditRequest(null, "Alex", 100, "lobby_parkour", "ok", "e6")),
        "UUID");
    assertEquals(0, fixture.producer.metrics().captured());
  }

  @Test
  void rejectsWhenGameplaySyncDisabled() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("lobby-1", "lobby", """
        modules:
          economy: true
        economy:
          enabled: true
        """);
    Fixture fixture = new Fixture(config, newProducer(config));
    GameplayCreditService.CreditResponse response = credit(fixture, 100, "lobby_parkour", "parkour_test", "e1");
    assertFalse(response.accepted());
    assertNotNull(response.rejectionReason());
  }

  @Test
  void rejectsBackendNotAllowlisted() throws InvalidConfigurationException {
    // gameplaySync allowlists smp-1 only, but this server is lobby-1
    RealCoreConfig config = loadConfig("lobby-1", "lobby",
        lobbyYaml(true, "lobby_parkour", 50_000, "smp-1"));
    Fixture fixture = new Fixture(config, newProducer(config));
    assertRejected(credit(fixture, 100, "lobby_parkour", "parkour_test", "e1"), "backendAllowlist");
  }

  @Test
  void rejectsSourceNotAllowlisted() throws InvalidConfigurationException {
    Fixture fixture = lobbyFixture(true, "some_other_source", 50_000);
    assertRejected(credit(fixture, 100, "lobby_parkour", "parkour_test", "e1"), "allowedSources");
  }

  @Test
  void rejectsOnAnarchy() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("anarchy-1", "anarchy",
        lobbyYaml(true, "lobby_parkour", 50_000, "anarchy-1"));
    Fixture fixture = new Fixture(config, newProducer(config));
    assertRejected(credit(fixture, 100, "lobby_parkour", "parkour_test", "e1"), "Anarchy");
  }

  @Test
  void dryRunAcceptsWithoutLedgerWrite() throws InvalidConfigurationException {
    Fixture fixture = lobbyFixture(true, "lobby_parkour", 50_000);
    GameplayCreditService.CreditResponse response =
        credit(fixture, 2500, "lobby_parkour", "parkour_test_dryrun", "e1");
    assertTrue(response.accepted());
    assertTrue(response.dryRun());
    assertNotNull(response.idempotencyKey());
    assertEquals(1, fixture.producer.metrics().dryRunCaptured());
    assertEquals(0, fixture.producer.metrics().queued());
  }

  @Test
  void livePathQueuesToLedgerBufferOnce() throws InvalidConfigurationException {
    Fixture fixture = lobbyFixture(false, "lobby_parkour", 50_000);
    GameplayCreditService.CreditResponse response =
        credit(fixture, 1, "lobby_parkour", "parkour_test_live", "live-1");
    assertTrue(response.accepted());
    assertFalse(response.dryRun());
    assertEquals(1, fixture.producer.metrics().queued());

    // identical eventId is rejected by the producer dedup — deterministic
    // eventIds give caller-side idempotency a second safety net
    GameplayCreditService.CreditResponse duplicate =
        credit(fixture, 1, "lobby_parkour", "parkour_test_live", "live-1");
    assertFalse(duplicate.accepted());
    assertTrue(duplicate.rejectionReason().contains("duplicate"));
    assertEquals(1, fixture.producer.metrics().queued());
  }

  @Test
  void rejectsWhenGameplayEarnCategoryDisabled() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("lobby-1", "lobby", """
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            dryRun: true
            backendAllowlist:
              - lobby-1
            categories:
              gameplayEarn: false
              gameplaySpend: false
            generic:
              enabled: true
              dryRun: true
              allowedSources:
                - lobby_parkour
              allowGameplayEarn: false
              allowGameplaySpend: false
        """);
    Fixture fixture = new Fixture(config, newProducer(config));
    GameplayCreditService.CreditResponse response =
        credit(fixture, 100, "lobby_parkour", "parkour_test", "e1");
    assertFalse(response.accepted());
    assertTrue(response.rejectionReason().contains("allowGameplayEarn")
        || response.rejectionReason().contains("gameplayEarn"));
  }

  // --- fixtures ---

  private record Fixture(RealCoreConfig config, GenericGameplayEconomyProducerService producer) {}

  private static GameplayCreditService.CreditResponse credit(
      Fixture fixture, long amountMinor, String source, String reason, String eventId) {
    return GameplayCreditService.credit(fixture.config, fixture.producer,
        new GameplayCreditService.CreditRequest(PLAYER, "Alex", amountMinor, source, reason, eventId));
  }

  private static void assertRejected(GameplayCreditService.CreditResponse response, String reasonPart) {
    assertFalse(response.accepted());
    assertNotNull(response.rejectionReason());
    assertTrue(response.rejectionReason().contains(reasonPart),
        "expected rejection mentioning '" + reasonPart + "' but was: " + response.rejectionReason());
  }

  private static Fixture lobbyFixture(boolean dryRun, String allowedSource, long maxCredit)
      throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("lobby-1", "lobby",
        lobbyYaml(dryRun, allowedSource, maxCredit, "lobby-1"));
    return new Fixture(config, newProducer(config));
  }

  private static String lobbyYaml(boolean dryRun, String allowedSource, long maxCredit, String allowedBackend) {
    return """
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            dryRun: %s
            maxCreditMinorPerTx: %d
            backendAllowlist:
              - %s
            categories:
              gameplayEarn: true
              gameplaySpend: false
            generic:
              enabled: true
              dryRun: %s
              allowedSources:
                - %s
              allowGameplayEarn: true
              allowGameplaySpend: false
        """.formatted(dryRun, maxCredit, allowedBackend, dryRun, allowedSource);
  }

  private static GenericGameplayEconomyProducerService newProducer(RealCoreConfig config) {
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

  private static RealCoreConfig loadConfig(String serverId, String serverGroup, String yaml)
      throws InvalidConfigurationException {
    YamlConfiguration configuration = new YamlConfiguration();
    configuration.loadFromString("""
        baseUrl: "https://realfiction.test"
        server:
          id: "%s"
          group: "%s"
          displayName: "Test"
        hmacSecret: "test-secret"
        """.formatted(serverId, serverGroup) + yaml);
    return RealCoreConfig.from(configuration);
  }

  private static final class NoopScheduler implements RealCoreScheduler {
    @Override public String name() { return "noop"; }

    @Override public boolean folia() { return false; }

    @Override public void runAsync(Runnable task) { task.run(); }

    @Override public ScheduledTaskHandle runAsyncRepeating(Runnable task, long initialDelaySeconds, long periodSeconds) {
      return () -> { };
    }

    @Override public ScheduledTaskHandle runGlobalRepeating(Runnable task, long initialDelayTicks, long periodTicks) {
      return () -> { };
    }

    @Override public void runGlobal(Runnable task) { task.run(); }

    @Override public void runForPlayer(Player player, Runnable task) { task.run(); }

    @Override public void runForPlayerLater(Player player, Runnable task, long delayTicks) { task.run(); }

    @Override public java.util.concurrent.CompletableFuture<Void> dispatchConsoleCommand(String command) {
      return java.util.concurrent.CompletableFuture.completedFuture(null);
    }

    @Override public void close() { }
  }
}
