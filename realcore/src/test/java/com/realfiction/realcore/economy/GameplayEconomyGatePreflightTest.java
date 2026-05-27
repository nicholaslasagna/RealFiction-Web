package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.lang.reflect.Field;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Logger;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;

final class GameplayEconomyGatePreflightTest {
  private static final GameplayEconomyPreflightService SERVICE = new GameplayEconomyPreflightService();
  private static final GameplayEconomyPreflightService.RuntimeProbe ALL_DEPS =
      new GameplayEconomyPreflightService.RuntimeProbe() {
        @Override public boolean vaultInstalled() { return true; }
        @Override public boolean vaultEconomyProviderRegistered() { return true; }
        @Override public boolean economyShopGuiPresent() { return true; }
        @Override public boolean placeholderApiPresent() { return false; }
        @Override public boolean luckPermsPresent() { return false; }
      };

  @Test
  void gateBPassesWithSellOnly() throws Exception {
    RealCoreConfig config = loadConfig(gateBDryRunYaml(""));
    var report = run(GameplayEconomyPreflightService.Mode.DRYRUN_SELL, config);
    assertTrue(report.ready());
    assertCheck(report, "shopSell", GameplayEconomyPreflightService.Status.PASS);
    assertCheck(report, "shopBuyDisabled", GameplayEconomyPreflightService.Status.PASS);
    assertCheck(report, "buyProducerDisabled", GameplayEconomyPreflightService.Status.PASS);
    assertCheck(report, "noWriterEnqueue", GameplayEconomyPreflightService.Status.PASS);
  }

  @Test
  void gateBFailsIfBuyCategoryEnabled() throws Exception {
    RealCoreConfig config = loadConfig(gateBDryRunYaml("""
            categories:
              shopBuy: true
        """));
    var report = run(GameplayEconomyPreflightService.Mode.DRYRUN_SELL, config);
    assertCheck(report, "shopBuyDisabled", GameplayEconomyPreflightService.Status.FAIL);
    assertFalse(report.ready());
  }

  @Test
  void gateBFailsIfBuyProducerEnabled() throws Exception {
    RealCoreConfig config = loadConfig(gateBDryRunYaml("""
            producers:
              economyShopGuiBuy:
                enabled: true
        """));
    var report = run(GameplayEconomyPreflightService.Mode.DRYRUN_SELL, config);
    assertCheck(report, "buyProducerDisabled", GameplayEconomyPreflightService.Status.FAIL);
    assertFalse(report.ready());
  }

  @Test
  void gateCPassesWithSellAndBuyEnabled() throws Exception {
    RealCoreConfig config = loadConfig(gateCDryRunYaml(""));
    var report = run(GameplayEconomyPreflightService.Mode.DRYRUN_BUY, config);
    assertTrue(report.ready());
    assertCheck(report, "shopBuy", GameplayEconomyPreflightService.Status.PASS);
    assertCheck(report, "buyProducerEnabled", GameplayEconomyPreflightService.Status.PASS);
    assertCheck(report, "sellProducerDryRun", GameplayEconomyPreflightService.Status.PASS);
    assertCheck(report, "buyProducerDryRun", GameplayEconomyPreflightService.Status.PASS);
    assertCheck(report, "genericProducerDisabled", GameplayEconomyPreflightService.Status.PASS);
  }

  @Test
  void gateCFailsIfBuyCategoryDisabledButProducerEnabled() throws Exception {
    RealCoreConfig config = loadConfig(gateCDryRunYaml("""
            categories:
              shopBuy: false
            producers:
              economyShopGuiBuy:
                enabled: true
        """));
    var report = run(GameplayEconomyPreflightService.Mode.DRYRUN_BUY, config);
    assertCheck(report, "shopBuy", GameplayEconomyPreflightService.Status.FAIL);
    assertFalse(report.ready());
  }

  @Test
  void gateCFailsIfBuyCategoryEnabledButProducerDisabled() throws Exception {
    RealCoreConfig config = loadConfig(gateCDryRunYaml("""
            producers:
              economyShopGuiBuy:
                enabled: false
        """));
    var report = run(GameplayEconomyPreflightService.Mode.DRYRUN_BUY, config);
    assertCheck(report, "buyProducerEnabled", GameplayEconomyPreflightService.Status.FAIL);
    assertFalse(report.ready());
  }

  @Test
  void gateCFailsIfSellProducerDryRunFalse() throws Exception {
    RealCoreConfig config = loadConfig(gateCDryRunYaml("""
            producers:
              economyShopGuiSell:
                dryRun: false
        """));
    var report = run(GameplayEconomyPreflightService.Mode.DRYRUN_BUY, config);
    assertCheck(report, "sellProducerDryRun", GameplayEconomyPreflightService.Status.FAIL);
    assertFalse(report.ready());
  }

  @Test
  void gateCFailsIfBuyProducerDryRunFalse() throws Exception {
    RealCoreConfig config = loadConfig(gateCDryRunYaml("""
            producers:
              economyShopGuiBuy:
                dryRun: false
        """));
    var report = run(GameplayEconomyPreflightService.Mode.DRYRUN_BUY, config);
    assertCheck(report, "buyProducerDryRun", GameplayEconomyPreflightService.Status.FAIL);
    assertFalse(report.ready());
  }

  @Test
  void gateCFailsIfGameplayQueueNonzero() throws Exception {
    RealCoreConfig config = loadConfig(gateCDryRunYaml(""));
    EconomyService economy = economy(config);
    GameplayEconomyTransactionBuffer buffer = new GameplayEconomyTransactionBuffer(
        config, economy, new GameplayEconomyWriterMetrics(), null, Logger.getLogger("test"));
    setGameplayQueueDepth(buffer, 1);
    var report = SERVICE.run(
        GameplayEconomyPreflightService.Mode.DRYRUN_BUY,
        new GameplayEconomyPreflightService.Snapshot(config, economy, buffer, ALL_DEPS)
    );
    assertCheck(report, "noWriterEnqueue", GameplayEconomyPreflightService.Status.FAIL);
    assertFalse(report.ready());
  }

  @Test
  void legacyDryrunFailsWhenShopBuyEnabled() throws Exception {
    RealCoreConfig config = loadConfig(gateCDryRunYaml(""));
    var report = run(GameplayEconomyPreflightService.Mode.DRYRUN, config);
    assertCheck(report, "shopBuyDisabled", GameplayEconomyPreflightService.Status.FAIL);
    assertFalse(report.ready());
  }

  @Test
  void livePreflightStillRequiresShopBuyOff() throws Exception {
    RealCoreConfig config = loadConfig("""
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
              shopSell: true
              shopBuy: true
            producers:
              economyShopGuiSell:
                enabled: true
        """);
    EconomyService economy = economy(config);
    var report = SERVICE.run(
        GameplayEconomyPreflightService.Mode.LIVE,
        new GameplayEconomyPreflightService.Snapshot(config, economy, null, ALL_DEPS)
    );
    assertCheck(report, "shopBuyDisabled", GameplayEconomyPreflightService.Status.FAIL);
    assertFalse(report.ready());
  }

  @Test
  void parseModeAcceptsGateAliases() {
    assertEquals(GameplayEconomyPreflightService.Mode.DRYRUN_SELL, GameplayEconomyPreflightService.parseMode("dryrun-sell"));
    assertEquals(GameplayEconomyPreflightService.Mode.DRYRUN_BUY, GameplayEconomyPreflightService.parseMode("dryrun_buy"));
    assertEquals(GameplayEconomyPreflightService.Mode.LIVE, GameplayEconomyPreflightService.parseMode("live"));
  }

  private static GameplayEconomyPreflightService.Report run(
      GameplayEconomyPreflightService.Mode mode,
      RealCoreConfig config
  ) throws Exception {
    EconomyService economy = economy(config);
    GameplayEconomyTransactionBuffer buffer = new GameplayEconomyTransactionBuffer(
        config, economy, new GameplayEconomyWriterMetrics(), null, Logger.getLogger("test"));
    return SERVICE.run(
        mode,
        new GameplayEconomyPreflightService.Snapshot(config, economy, buffer, ALL_DEPS)
    );
  }

  private static EconomyService economy(RealCoreConfig config) {
    EconomyService service = new EconomyService(
        config, new NoopScheduler(), new PlatformApiClient(config, Logger.getLogger("test")), Logger.getLogger("test"));
    service.start();
    return service;
  }

  private static String gateBDryRunYaml(String extra) {
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
                dryRun: true
              economyShopGuiBuy:
                enabled: false
            generic:
              enabled: false
        """ + extra;
  }

  private static String gateCDryRunYaml(String extra) {
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
              shopBuy: true
            producers:
              economyShopGuiSell:
                enabled: true
                dryRun: true
              economyShopGuiBuy:
                enabled: true
                dryRun: true
            generic:
              enabled: false
        """ + extra;
  }

  private static RealCoreConfig loadConfig(String yaml) throws InvalidConfigurationException {
    YamlConfiguration configuration = new YamlConfiguration();
    configuration.loadFromString("""
        baseUrl: "https://realfiction.test"
        server:
          id: "smp-1"
          group: "smp"
        hmacSecret: "test-secret"
        """ + yaml);
    return RealCoreConfig.from(configuration);
  }

  private static void assertCheck(
      GameplayEconomyPreflightService.Report report,
      String id,
      GameplayEconomyPreflightService.Status status
  ) {
    GameplayEconomyPreflightService.Check check = report.checks().stream()
        .filter(c -> c.id().equals(id))
        .findFirst()
        .orElseThrow(() -> new AssertionError("missing check " + id));
    assertEquals(status, check.status(), () -> "check " + id + " detail=" + check.detail());
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
