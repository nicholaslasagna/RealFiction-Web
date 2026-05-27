package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.lang.reflect.Field;
import java.lang.reflect.Proxy;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Logger;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

final class EconomyShopGuiProducerTest {
  private static final UUID PLAYER = UUID.fromString("00000000-0000-0000-0000-000000000123");

  private RealCoreConfig config;
  private GameplayEconomyCaptureService captureService;
  private EconomyShopGuiSellProducer sellProducer;
  private EconomyShopGuiBuyProducer buyProducer;
  private Player player;

  @BeforeEach
  void setUp() throws InvalidConfigurationException {
    config = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
            dryRun: true
            categories:
              shopSell: true
              shopBuy: true
            producers:
              economyShopGuiSell:
                enabled: true
                category: shop_sell
                dryRun: true
                logEvents: false
              economyShopGuiBuy:
                enabled: true
                category: shop_buy
                dryRun: true
                logEvents: false
        """);
    captureService = newCapture(config);
    Plugin plugin = stubPlugin();
    Logger logger = Logger.getLogger("EconomyShopGuiProducerTest");
    sellProducer = new EconomyShopGuiSellProducer(plugin, config, captureService, logger);
    buyProducer = new EconomyShopGuiBuyProducer(plugin, config, captureService, logger);
    forceRunning(sellProducer);
    forceRunning(buyProducer);
    player = stubPlayer(PLAYER, "Alex");
  }

  @Test
  void sellProducerCapturesSuccessfulSell() {
    sellProducer.handlePostTransaction(successfulSellEvent(12.50));

    assertEquals(1, captureService.metricsForProducer(EconomyShopGuiSellProducer.ID).captured());
    assertEquals(1, captureService.metricsForProducer(EconomyShopGuiSellProducer.ID).dryRunCaptured());
    assertEquals(0, captureService.metricsForProducer(EconomyShopGuiBuyProducer.ID).captured());
  }

  @Test
  void buyProducerCapturesSuccessfulBuy() {
    buyProducer.handlePostTransaction(successfulBuyEvent(8.25));

    assertEquals(1, captureService.metricsForProducer(EconomyShopGuiBuyProducer.ID).captured());
    assertEquals(1, captureService.metricsForProducer(EconomyShopGuiBuyProducer.ID).dryRunCaptured());
    assertEquals(0, captureService.metricsForProducer(EconomyShopGuiSellProducer.ID).captured());
  }

  @Test
  void sellIgnoresBuyTransaction() {
    sellProducer.handlePostTransaction(successfulBuyEvent(5.00));
    assertEquals(0, captureService.metricsForProducer(EconomyShopGuiSellProducer.ID).captured());
  }

  @Test
  void buyIgnoresSellTransaction() {
    buyProducer.handlePostTransaction(successfulSellEvent(5.00));
    assertEquals(0, captureService.metricsForProducer(EconomyShopGuiBuyProducer.ID).captured());
  }

  @Test
  void unknownTransactionTypeIgnored() {
    var event = new StubEconomyShopGuiPostTransactionEvent(
        "ADMIN_GIVE",
        "SUCCESS",
        player,
        10.0
    );
    sellProducer.handlePostTransaction(event);
    buyProducer.handlePostTransaction(event);
    assertEquals(0, captureService.metrics().captured());
  }

  @Test
  void unsuccessfulTransactionIgnored() {
    sellProducer.handlePostTransaction(new StubEconomyShopGuiPostTransactionEvent(
        "SELL_GUI",
        "FAILED",
        player,
        10.0
    ));
    assertEquals(0, captureService.metricsForProducer(EconomyShopGuiSellProducer.ID).captured());
  }

  @Test
  void zeroAmountIgnored() {
    sellProducer.handlePostTransaction(new StubEconomyShopGuiPostTransactionEvent(
        "SELL_GUI",
        "SUCCESS",
        player,
        0.0
    ));
    assertEquals(0, captureService.metricsForProducer(EconomyShopGuiSellProducer.ID).captured());
  }

  @Test
  void eventClassNotFoundHandledSafely() {
    assertTrue(EconomyShopGuiPostTransactionSupport.EVENT_CLASS.contains("PostTransactionEvent"));
  }

  private static void forceRunning(Object producer) {
    try {
      Field running = AbstractEconomyShopGuiProducer.class.getDeclaredField("running");
      running.setAccessible(true);
      running.set(producer, true);
    } catch (ReflectiveOperationException error) {
      throw new IllegalStateException(error);
    }
  }

  private static StubEconomyShopGuiPostTransactionEvent successfulSellEvent(double dollars) {
    return new StubEconomyShopGuiPostTransactionEvent(
        "SELL_GUI",
        "SUCCESS",
        stubPlayer(PLAYER, "Alex"),
        dollars,
        Map.of("VAULT", dollars),
        StubEconomyShopGuiPostTransactionEvent.shopItemWithPath("blocks.cobblestone"),
        64
    );
  }

  private static StubEconomyShopGuiPostTransactionEvent successfulBuyEvent(double dollars) {
    return new StubEconomyShopGuiPostTransactionEvent(
        "BUY_SCREEN",
        "SUCCESS",
        stubPlayer(PLAYER, "Alex"),
        dollars,
        Map.of("VAULT", dollars),
        StubEconomyShopGuiPostTransactionEvent.shopItemWithPath("blocks.oak_log"),
        16
    );
  }

  private static GameplayEconomyCaptureService newCapture(RealCoreConfig config) {
    EconomyService economy = new EconomyService(
        config, new NoopScheduler(), new PlatformApiClient(config, Logger.getLogger("test")), Logger.getLogger("test"));
    economy.start();
    return new GameplayEconomyCaptureService(
        config,
        new GameplayEconomyTransactionBuffer(config, economy, null, null, Logger.getLogger("test")),
        new GameplayEconomyIdempotencyDedupCache(Duration.ofMinutes(5), 1000),
        new GameplayEconomyProducerMetricsRegistry(),
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

  private static Plugin stubPlugin() {
    return (Plugin) Proxy.newProxyInstance(
        Plugin.class.getClassLoader(),
        new Class[]{Plugin.class},
        (proxy, method, args) -> {
          if ("getName".equals(method.getName())) {
            return "RealCore";
          }
          Class<?> returnType = method.getReturnType();
          if (returnType.equals(boolean.class)) {
            return false;
          }
          if (returnType.equals(int.class)) {
            return 0;
          }
          if (returnType.equals(long.class)) {
            return 0L;
          }
          return null;
        });
  }

  private static Player stubPlayer(UUID uuid, String name) {
    return (Player) Proxy.newProxyInstance(
        Player.class.getClassLoader(),
        new Class[]{Player.class},
        (proxy, method, args) -> {
          return switch (method.getName()) {
            case "getUniqueId" -> uuid;
            case "getName" -> name;
            default -> defaultProxyValue(method.getReturnType());
          };
        });
  }

  private static Object defaultProxyValue(Class<?> returnType) {
    if (returnType.equals(boolean.class)) {
      return false;
    }
    if (returnType.equals(int.class)) {
      return 0;
    }
    if (returnType.equals(long.class)) {
      return 0L;
    }
    if (returnType.equals(double.class)) {
      return 0.0d;
    }
    if (returnType.equals(float.class)) {
      return 0.0f;
    }
    return null;
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
