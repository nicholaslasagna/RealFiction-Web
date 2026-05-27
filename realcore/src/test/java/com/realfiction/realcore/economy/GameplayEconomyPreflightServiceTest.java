package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.lang.reflect.Field;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Logger;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

final class GameplayEconomyPreflightServiceTest {
  private static final GameplayEconomyPreflightService SERVICE = new GameplayEconomyPreflightService();
  private static final GameplayEconomyPreflightService.RuntimeProbe ALL_DEPS =
      new GameplayEconomyPreflightService.RuntimeProbe() {
        @Override public boolean vaultInstalled() { return true; }
        @Override public boolean vaultEconomyProviderRegistered() { return true; }
        @Override public boolean economyShopGuiPresent() { return true; }
        @Override public boolean placeholderApiPresent() { return false; }
        @Override public boolean luckPermsPresent() { return false; }
      };

  private EconomyService economyService;
  private GameplayEconomyTransactionBuffer buffer;

  @BeforeEach
  void setUp() throws Exception {
    RealCoreConfig config = dryRunSmpConfig();
    economyService = new EconomyService(
        config, new NoopScheduler(), new PlatformApiClient(config, Logger.getLogger("test")), Logger.getLogger("test"));
    economyService.start();
    buffer = new GameplayEconomyTransactionBuffer(config, economyService, new GameplayEconomyWriterMetrics(), null,
        Logger.getLogger("test"));
  }

  @Test
  void anarchyGroupAlwaysFails() throws Exception {
    RealCoreConfig config = loadConfig("""
        server:
          id: "smp-1"
          group: "anarchy"
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            dryRun: true
        """);
    GameplayEconomyPreflightService.Report report = runDryRun(config, null, null, ALL_DEPS);
    assertCheck(report, "anarchyBlocked", GameplayEconomyPreflightService.Status.FAIL);
    assertFalse(report.ready());
  }

  @Test
  void dryRunSafeConfigPasses() throws Exception {
    GameplayEconomyPreflightService.Report report = runDryRun(dryRunSmpConfig(), economyService, buffer, ALL_DEPS);
    assertCheck(report, "dryRunRequired", GameplayEconomyPreflightService.Status.PASS);
    assertCheck(report, "noWriterEnqueue", GameplayEconomyPreflightService.Status.PASS);
    assertTrue(findCheck(report, "hmacSecret").status() == GameplayEconomyPreflightService.Status.PASS);
    assertFalse(hasFail(report, "anarchyBlocked"));
  }

  @Test
  void liveModeFailsWhenDryRunTrue() throws Exception {
    GameplayEconomyPreflightService.Report report = runLive(dryRunSmpConfig(), economyService, buffer, ALL_DEPS);
    assertCheck(report, "dryRun", GameplayEconomyPreflightService.Status.FAIL);
    assertCheck(report, "liveDryRunOff", GameplayEconomyPreflightService.Status.FAIL);
    assertFalse(report.ready());
  }

  @Test
  void liveModeFailsWhenProducerDisabled() throws Exception {
    RealCoreConfig config = loadConfig(liveSmpYaml("""
            producers:
              economyShopGuiSell:
                enabled: false
        """));
    economyService = new EconomyService(
        config, new NoopScheduler(), new PlatformApiClient(config, Logger.getLogger("test")), Logger.getLogger("test"));
    economyService.start();
    GameplayEconomyPreflightService.Report report = runLive(config, economyService, buffer, ALL_DEPS);
    assertCheck(report, "producerDisabled", GameplayEconomyPreflightService.Status.FAIL);
    assertFalse(report.ready());
  }

  @Test
  void liveModeFailsWhenShopBuyEnabled() throws Exception {
    RealCoreConfig config = loadConfig(liveSmpYaml("""
            categories:
              shopBuy: true
        """));
    GameplayEconomyPreflightService.Report report = runLive(config, economyService, buffer, ALL_DEPS);
    assertCheck(report, "shopBuyDisabled", GameplayEconomyPreflightService.Status.FAIL);
    assertFalse(report.ready());
  }

  @Test
  void liveModeWarnsWhenDbPolicyCannotBeProven() throws Exception {
    GameplayEconomyPreflightService.Report base = runLive(dryRunSmpConfig(), economyService, buffer, ALL_DEPS);
    GameplayEconomyPreflightService.Report withApi = SERVICE.withApiChecks(
        base,
        GameplayEconomyPreflightService.ApiProbeResult.success()
    );
    assertCheck(withApi, "dbPolicyWritePermissionNotProven", GameplayEconomyPreflightService.Status.WARN);
  }

  @Test
  void missingHmacFails() throws Exception {
    RealCoreConfig config = loadConfig("""
        hmacSecret: ""
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            dryRun: true
        """);
    GameplayEconomyPreflightService.Report report = runDryRun(config, null, null, ALL_DEPS);
    assertCheck(report, "hmacSecret", GameplayEconomyPreflightService.Status.FAIL);
    assertCheck(report, "baseUrl", GameplayEconomyPreflightService.Status.PASS);
    assertFalse(report.ready());
  }

  @Test
  void queueNearCapacityWarns() throws Exception {
    RealCoreConfig config = loadConfig(dryRunSmpYaml("""
            observability:
              maxQueueEntries: 10
        """));
    buffer = new GameplayEconomyTransactionBuffer(config, economyService, new GameplayEconomyWriterMetrics(), null,
        Logger.getLogger("test"));
    setGameplayQueueDepth(buffer, 9);
    GameplayEconomyPreflightService.Report report = runDryRun(config, economyService, buffer, ALL_DEPS);
    assertCheck(report, "gameplayQueue", GameplayEconomyPreflightService.Status.WARN);
  }

  @Test
  void recentWriterFailureFails() throws Exception {
    BufferedEconomyTransactionWriter writer = economyService.writer();
    setLastFailure(writer, System.currentTimeMillis(), "HTTP 503: upstream");
    GameplayEconomyPreflightService.Report report = runDryRun(dryRunSmpConfig(), economyService, buffer, ALL_DEPS);
    assertCheck(report, "recentWriterFailure", GameplayEconomyPreflightService.Status.FAIL);
    assertFalse(report.ready());
  }

  @Test
  void noSecretsPrintedInFormattedOutput() throws Exception {
    RealCoreConfig config = loadConfig("""
        hmacSecret: "super-secret-value-12345"
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            dryRun: true
        """);
    GameplayEconomyPreflightService.Report report = runDryRun(config, economyService, buffer, ALL_DEPS);
    String joined = String.join("\n", report.formatLines());
    assertFalse(joined.contains("super-secret-value-12345"));
    assertFalse(joined.toLowerCase(Locale.ROOT).contains("secret=value"));
  }

  private static GameplayEconomyPreflightService.Report runDryRun(
      RealCoreConfig config,
      EconomyService economy,
      GameplayEconomyTransactionBuffer buffer,
      GameplayEconomyPreflightService.RuntimeProbe probe
  ) {
    return SERVICE.run(
        GameplayEconomyPreflightService.Mode.DRYRUN,
        new GameplayEconomyPreflightService.Snapshot(config, economy, buffer, probe)
    );
  }

  private static GameplayEconomyPreflightService.Report runLive(
      RealCoreConfig config,
      EconomyService economy,
      GameplayEconomyTransactionBuffer buffer,
      GameplayEconomyPreflightService.RuntimeProbe probe
  ) {
    return SERVICE.run(
        GameplayEconomyPreflightService.Mode.LIVE,
        new GameplayEconomyPreflightService.Snapshot(config, economy, buffer, probe)
    );
  }

  private static void assertCheck(
      GameplayEconomyPreflightService.Report report,
      String id,
      GameplayEconomyPreflightService.Status status
  ) {
    assertEquals(status, findCheck(report, id).status(), () -> "check " + id);
  }

  private static GameplayEconomyPreflightService.Check findCheck(
      GameplayEconomyPreflightService.Report report,
      String id
  ) {
    return report.checks().stream()
        .filter(check -> check.id().equals(id))
        .findFirst()
        .orElseThrow(() -> new AssertionError("missing check " + id));
  }

  private static boolean hasFail(GameplayEconomyPreflightService.Report report, String id) {
    return findCheck(report, id).status() == GameplayEconomyPreflightService.Status.FAIL;
  }

  private static RealCoreConfig dryRunSmpConfig() throws InvalidConfigurationException {
    return loadConfig(dryRunSmpYaml(""));
  }

  private static String dryRunSmpYaml(String extra) {
    return """
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            dryRun: true
            backendAllowlist:
              - smp-1
            categories:
              gameplayEarn: false
              gameplaySpend: false
              shopSell: true
              shopBuy: false
            producers:
              economyShopGuiSell:
                enabled: true
        """ + extra;
  }

  private static String liveSmpYaml(String extra) {
    return """
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            dryRun: false
            backendAllowlist:
              - smp-1
            maxCreditMinorPerTx: 50000
            maxDebitMinorPerTx: 50000
            categories:
              gameplayEarn: false
              gameplaySpend: false
              shopSell: true
              shopBuy: false
            producers:
              economyShopGuiSell:
                enabled: true
        """ + extra;
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

  private static void setGameplayQueueDepth(GameplayEconomyTransactionBuffer buffer, int depth) throws Exception {
    Field queueField = GameplayEconomyTransactionBuffer.class.getDeclaredField("gameplayQueue");
    queueField.setAccessible(true);
    @SuppressWarnings("unchecked")
    java.util.concurrent.ConcurrentLinkedQueue<Object> queue =
        (java.util.concurrent.ConcurrentLinkedQueue<Object>) queueField.get(buffer);
    Class<?> entryClass = Class.forName(
        "com.realfiction.realcore.economy.GameplayEconomyTransactionBuffer$QueuedEntry");
    var ctor = entryClass.getDeclaredConstructor(EconomyTransaction.class, long.class);
    ctor.setAccessible(true);
    for (int i = 0; i < depth; i++) {
      EconomyTransaction tx = new EconomyTransaction(
          UUID.randomUUID(),
          "probe",
          100,
          EconomyCategory.SHOP_SELL,
          "preflight-probe",
          "gameplay:smp-1:shop_sell:probe:" + UUID.randomUUID() + ":e" + i,
          "preflight",
          "e" + i,
          Map.of()
      );
      queue.add(ctor.newInstance(tx, System.currentTimeMillis()));
    }
  }

  private static void setLastFailure(BufferedEconomyTransactionWriter writer, long atMillis, String message)
      throws Exception {
    Field atField = BufferedEconomyTransactionWriter.class.getDeclaredField("lastFailureAt");
    atField.setAccessible(true);
    ((java.util.concurrent.atomic.AtomicLong) atField.get(writer)).set(atMillis);
    Field messageField = BufferedEconomyTransactionWriter.class.getDeclaredField("lastFailureMessage");
    messageField.setAccessible(true);
    messageField.set(writer, message);
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
