package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.config.GameplayEconomyProducerConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.time.Duration;
import java.util.UUID;
import java.util.logging.Logger;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

final class GameplayEconomyCaptureServiceTest {
  private static final UUID PLAYER = UUID.fromString("00000000-0000-0000-0000-000000000123");

  private EconomyService economyService;
  private GameplayEconomyCaptureService capture;
  private GameplayEconomyProducerMetrics metrics;
  private GameplayEconomyProducerConfig producerConfig;

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
              shopSell: true
            producers:
              economyShopGuiSell:
                enabled: true
                category: shop_sell
                dryRun: true
                logEvents: false
        """);
    economyService = new EconomyService(
        config, new NoopScheduler(), new PlatformApiClient(config, Logger.getLogger("test")), Logger.getLogger("test"));
    economyService.start();
    metrics = new GameplayEconomyProducerMetrics();
    capture = newCapture(config, metrics);
    producerConfig = config.economy().gameplaySync().producers().economyShopGuiSell();
  }

  @Test
  void producerDisabledIncrementsDisabledCounter() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            producers:
              economyShopGuiSell:
                enabled: false
        """);
    GameplayEconomyProducerMetrics disabledMetrics = new GameplayEconomyProducerMetrics();
    GameplayEconomyCaptureService service = newCapture(config, disabledMetrics);
    service.capture(sellRequest(config, disabledMetrics, 100));
    assertEquals(1, disabledMetrics.producerDisabledRejected());
  }

  @Test
  void gameplaySyncDisabledRejects() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: false
            producers:
              economyShopGuiSell:
                enabled: true
                category: shop_sell
        """);
    GameplayEconomyProducerMetrics rejectMetrics = new GameplayEconomyProducerMetrics();
    GameplayEconomyCaptureService service = newCapture(config, rejectMetrics);
    service.capture(sellRequest(config, rejectMetrics, 100));
    assertEquals(1, rejectMetrics.invalidRejected());
  }

  @Test
  void dryRunDoesNotQueueToWriter() {
    capture.capture(sellRequest(producerConfig, metrics, 250));
    assertEquals(1, metrics.dryRunCaptured());
    assertEquals(0, economyService.writer().queuedTransactionCount());
    assertEquals(0, metrics.queued());
  }

  @Test
  void shopBuyDryRunDoesNotQueueToWriter() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            dryRun: true
            categories:
              shopBuy: true
            producers:
              economyShopGuiBuy:
                enabled: true
                category: shop_buy
                dryRun: true
        """);
    GameplayEconomyProducerMetrics buyMetrics = new GameplayEconomyProducerMetrics();
    GameplayEconomyCaptureService service = newCapture(config, buyMetrics);
    GameplayEconomyProducerConfig buyConfig = config.economy().gameplaySync().producers().economyShopGuiBuy();
    service.capture(buyRequest(buyConfig, buyMetrics, 500));
    assertEquals(1, buyMetrics.dryRunCaptured());
    assertEquals(0, buyMetrics.queued());
  }

  @Test
  void overDebitCapRejected() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            maxDebitMinorPerTx: 100
            categories:
              shopBuy: true
            producers:
              economyShopGuiBuy:
                enabled: true
                category: shop_buy
                dryRun: true
        """);
    GameplayEconomyProducerMetrics buyMetrics = new GameplayEconomyProducerMetrics();
    GameplayEconomyCaptureService service = newCapture(config, buyMetrics);
    GameplayEconomyProducerConfig buyConfig = config.economy().gameplaySync().producers().economyShopGuiBuy();
    service.capture(buyRequest(buyConfig, buyMetrics, 500));
    assertEquals(1, buyMetrics.overCapRejected());
  }

  @Test
  void shopBuyCategoryDisabledRejected() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            categories:
              shopBuy: false
            producers:
              economyShopGuiBuy:
                enabled: true
                category: shop_buy
        """);
    GameplayEconomyProducerMetrics buyMetrics = new GameplayEconomyProducerMetrics();
    GameplayEconomyCaptureService service = newCapture(config, buyMetrics);
    GameplayEconomyProducerConfig buyConfig = config.economy().gameplaySync().producers().economyShopGuiBuy();
    service.capture(buyRequest(buyConfig, buyMetrics, 100));
    assertEquals(1, buyMetrics.invalidRejected());
  }

  @Test
  void duplicateSuppression() {
    GameplayEconomyCaptureService.CaptureRequest first = sellRequest(producerConfig, metrics, 100);
    capture.capture(first);
    capture.capture(first);
    assertEquals(1, metrics.captured());
    assertEquals(1, metrics.duplicateRejected());
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
            maxCreditMinorPerTx: 100
            categories:
              shopSell: true
            producers:
              economyShopGuiSell:
                enabled: true
                category: shop_sell
                dryRun: true
        """);
    GameplayEconomyProducerMetrics sellMetrics = new GameplayEconomyProducerMetrics();
    GameplayEconomyCaptureService service = newCapture(config, sellMetrics);
    service.capture(sellRequest(config, sellMetrics, 500));
    assertEquals(1, sellMetrics.overCapRejected());
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
            categories:
              shopSell: true
            producers:
              economyShopGuiSell:
                enabled: true
        """);
    GameplayEconomyProducerMetrics sellMetrics = new GameplayEconomyProducerMetrics();
    GameplayEconomyCaptureService service = newCapture(config, sellMetrics);
    service.capture(sellRequest(config, sellMetrics, 100));
    assertEquals(1, sellMetrics.invalidRejected());
  }

  @Test
  void allowlistEnforced() throws InvalidConfigurationException {
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
            categories:
              shopSell: true
            producers:
              economyShopGuiSell:
                enabled: true
        """);
    GameplayEconomyProducerMetrics sellMetrics = new GameplayEconomyProducerMetrics();
    GameplayEconomyCaptureService service = newCapture(config, sellMetrics);
    service.capture(sellRequest(config, sellMetrics, 100));
    assertEquals(1, sellMetrics.invalidRejected());
  }

  @Test
  void categoryDisabledRejected() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            categories:
              shopSell: false
            producers:
              economyShopGuiSell:
                enabled: true
                category: shop_sell
        """);
    GameplayEconomyProducerMetrics sellMetrics = new GameplayEconomyProducerMetrics();
    GameplayEconomyCaptureService service = newCapture(config, sellMetrics);
    service.capture(sellRequest(config, sellMetrics, 100));
    assertEquals(1, sellMetrics.invalidRejected());
  }

  @Test
  void idempotencyStableForSameEvent() {
    String key = GameplayEconomyIdempotencyKeys.build(
        "smp-1",
        GameplayEconomyCategory.SHOP_SELL,
        EconomyShopGuiSellProducer.SOURCE,
        PLAYER,
        "event-42"
    );
    String again = GameplayEconomyIdempotencyKeys.build(
        "smp-1",
        GameplayEconomyCategory.SHOP_SELL,
        EconomyShopGuiSellProducer.SOURCE,
        PLAYER,
        "event-42"
    );
    assertEquals(key, again);
    String buyKey = GameplayEconomyIdempotencyKeys.build(
        "smp-1",
        GameplayEconomyCategory.SHOP_BUY,
        EconomyShopGuiBuyProducer.SOURCE,
        PLAYER,
        "event-42"
    );
    assertEquals("gameplay:smp-1:shop_buy:economyshopgui:" + PLAYER + ":event-42", buyKey);
  }

  @Test
  void liveEnqueueWhenDryRunDisabled() throws InvalidConfigurationException {
    RealCoreConfig config = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            dryRun: false
            categories:
              shopSell: true
            producers:
              economyShopGuiSell:
                enabled: true
                dryRun: false
        """);
    EconomyService economy = new EconomyService(
        config, new NoopScheduler(), new PlatformApiClient(config, Logger.getLogger("test")), Logger.getLogger("test"));
    economy.start();
    GameplayEconomyProducerMetrics sellMetrics = new GameplayEconomyProducerMetrics();
    GameplayEconomyCaptureService service = new GameplayEconomyCaptureService(
        config,
        new GameplayEconomyTransactionBuffer(config, economy, null, null, Logger.getLogger("test")),
        new GameplayEconomyIdempotencyDedupCache(Duration.ofMinutes(5), 1000),
        null,
        null,
        Logger.getLogger("test"));
    service.capture(sellRequest(config, sellMetrics, 100));
    assertEquals(1, sellMetrics.queued());
    assertTrue(economy.writer().queuedTransactionCount() > 0);
  }

  private GameplayEconomyCaptureService newCapture(RealCoreConfig config, GameplayEconomyProducerMetrics metrics) {
    EconomyService economy = new EconomyService(
        config, new NoopScheduler(), new PlatformApiClient(config, Logger.getLogger("test")), Logger.getLogger("test"));
    economy.start();
    return new GameplayEconomyCaptureService(
        config,
        new GameplayEconomyTransactionBuffer(config, economy, null, null, Logger.getLogger("test")),
        new GameplayEconomyIdempotencyDedupCache(Duration.ofMinutes(5), 1000),
        null,
        null,
        Logger.getLogger("test"));
  }

  private static GameplayEconomyCaptureService.CaptureRequest sellRequest(
      RealCoreConfig config,
      GameplayEconomyProducerMetrics metrics,
      long amountMinor
  ) {
    return sellRequest(config.economy().gameplaySync().producers().economyShopGuiSell(), metrics, amountMinor);
  }

  private static GameplayEconomyCaptureService.CaptureRequest sellRequest(
      GameplayEconomyProducerConfig config,
      GameplayEconomyProducerMetrics metrics,
      long amountMinor
  ) {
    return new GameplayEconomyCaptureService.CaptureRequest(
        EconomyShopGuiSellProducer.ID,
        config,
        PLAYER,
        "Alex",
        amountMinor,
        EconomyShopGuiSellProducer.SOURCE,
        "event-" + amountMinor,
        "test",
        metrics
    );
  }

  private static GameplayEconomyCaptureService.CaptureRequest buyRequest(
      GameplayEconomyProducerConfig config,
      GameplayEconomyProducerMetrics metrics,
      long amountMinor
  ) {
    return new GameplayEconomyCaptureService.CaptureRequest(
        EconomyShopGuiBuyProducer.ID,
        config,
        PLAYER,
        "Alex",
        amountMinor,
        EconomyShopGuiBuyProducer.SOURCE,
        "event-" + amountMinor,
        "test",
        metrics
    );
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
