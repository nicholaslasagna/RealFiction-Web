package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.config.GameplayEconomyProducerConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.economy.GameplayEconomyCategory;
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
    capture = new GameplayEconomyCaptureService(
        config,
        new GameplayEconomyTransactionBuffer(config, economyService, null, null, Logger.getLogger("test")),
        new GameplayEconomyIdempotencyDedupCache(Duration.ofMinutes(5), 1000),
        new GameplayEconomyProducerMetrics(),
        null,
        null,
        Logger.getLogger("test"));
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
    GameplayEconomyCaptureService service = newCapture(config);
    service.capture(request(config, 100));
    assertEquals(1, service.metrics().producerDisabledRejected());
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
    GameplayEconomyCaptureService service = newCapture(config);
    service.capture(request(config, 100));
    assertEquals(1, service.metrics().invalidRejected());
  }

  @Test
  void dryRunDoesNotQueueToWriter() {
    capture.capture(request(producerConfig, 250));
    assertEquals(1, capture.metrics().dryRunCaptured());
    assertEquals(0, economyService.writer().queuedTransactionCount());
    assertEquals(0, capture.metrics().queued());
  }

  @Test
  void duplicateSuppression() {
    GameplayEconomyCaptureService.CaptureRequest first = request(producerConfig, 100);
    capture.capture(first);
    capture.capture(first);
    assertEquals(1, capture.metrics().captured());
    assertEquals(1, capture.metrics().duplicateRejected());
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
    GameplayEconomyCaptureService service = newCapture(config);
    service.capture(request(config, 500));
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
            categories:
              shopSell: true
            producers:
              economyShopGuiSell:
                enabled: true
        """);
    GameplayEconomyCaptureService service = newCapture(config);
    service.capture(request(config, 100));
    assertEquals(1, service.metrics().invalidRejected());
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
    GameplayEconomyCaptureService service = newCapture(config);
    service.capture(request(config, 100));
    assertEquals(1, service.metrics().invalidRejected());
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
    GameplayEconomyCaptureService service = newCapture(config);
    service.capture(request(config, 100));
    assertEquals(1, service.metrics().invalidRejected());
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
    GameplayEconomyCaptureService service = new GameplayEconomyCaptureService(
        config,
        new GameplayEconomyTransactionBuffer(config, economy, null, null, Logger.getLogger("test")),
        new GameplayEconomyIdempotencyDedupCache(Duration.ofMinutes(5), 1000),
        new GameplayEconomyProducerMetrics(),
        null,
        null,
        Logger.getLogger("test"));
    service.capture(request(config, 100));
    assertEquals(1, service.metrics().queued());
    assertTrue(economy.writer().queuedTransactionCount() > 0);
  }

  private GameplayEconomyCaptureService newCapture(RealCoreConfig config) {
    EconomyService economy = new EconomyService(
        config, new NoopScheduler(), new PlatformApiClient(config, Logger.getLogger("test")), Logger.getLogger("test"));
    economy.start();
    return new GameplayEconomyCaptureService(
        config,
        new GameplayEconomyTransactionBuffer(config, economy, null, null, Logger.getLogger("test")),
        new GameplayEconomyIdempotencyDedupCache(Duration.ofMinutes(5), 1000),
        new GameplayEconomyProducerMetrics(),
        null,
        null,
        Logger.getLogger("test"));
  }

  private static GameplayEconomyCaptureService.CaptureRequest request(RealCoreConfig config, long amountMinor) {
    return request(config.economy().gameplaySync().producers().economyShopGuiSell(), amountMinor);
  }

  private static GameplayEconomyCaptureService.CaptureRequest request(GameplayEconomyProducerConfig config, long amountMinor) {
    return new GameplayEconomyCaptureService.CaptureRequest(
        EconomyShopGuiSellProducer.ID,
        config,
        PLAYER,
        "Alex",
        amountMinor,
        EconomyShopGuiSellProducer.SOURCE,
        "event-" + amountMinor,
        "test"
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
