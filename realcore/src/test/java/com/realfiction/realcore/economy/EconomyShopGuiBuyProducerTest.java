package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.lang.reflect.Field;
import java.lang.reflect.Proxy;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Logger;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
final class EconomyShopGuiBuyProducerTest {
  private static final UUID PLAYER = UUID.fromString("00000000-0000-0000-0000-000000000123");

  private EconomyShopGuiBuyProducer producer;
  private GameplayEconomyProducerMetrics metrics;

  @BeforeEach
  void setUp() throws Exception {
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
    EconomyService economyService = new EconomyService(
        config, new NoopScheduler(), new PlatformApiClient(config, Logger.getLogger("test")), Logger.getLogger("test"));
    economyService.start();
    GameplayEconomyCaptureService capture = new GameplayEconomyCaptureService(
        config,
        new GameplayEconomyTransactionBuffer(config, economyService, null, null, Logger.getLogger("test")),
        new GameplayEconomyIdempotencyDedupCache(Duration.ofMinutes(5), 1000),
        null,
        null,
        Logger.getLogger("test"));
    producer = new EconomyShopGuiBuyProducer(fakePlugin(), config, capture, Logger.getLogger("test"));
    metrics = producer.metrics();
    setRunning(true);
  }

  @Test
  void producerDisabledByDefault() throws InvalidConfigurationException {
    RealCoreConfig defaults = loadConfig("""
        modules:
          economy: true
        economy:
          enabled: true
        """);
    assertFalse(defaults.economy().gameplaySync().producers().economyShopGuiBuy().enabled());
    assertTrue(defaults.economy().gameplaySync().producers().economyShopGuiBuy().dryRun());
    assertFalse(defaults.economy().gameplaySync().shopBuy());
  }

  @Test
  void buyEventDryRunCapture() {
    producer.handlePostTransaction(successfulBuy(12.50));
    assertEquals(1, metrics.captured());
    assertEquals(1, metrics.dryRunCaptured());
    assertEquals(0, metrics.queued());
  }

  @Test
  void failedBuyIgnored() {
    producer.handlePostTransaction(failedBuy(10.0));
    assertEquals(0, metrics.captured());
  }

  @Test
  void cancelledBuyIgnored() {
    producer.handlePostTransaction(cancelledBuy(10.0));
    assertEquals(0, metrics.captured());
  }

  @Test
  void sellEventIgnoredByBuyProducer() {
    producer.handlePostTransaction(successfulSell(10.0));
    assertEquals(0, metrics.captured());
  }

  @Test
  void nonMoneyTransactionIgnored() {
    producer.handlePostTransaction(new FakePostTransaction("BUY", "SUCCESS", Map.of("ITEM", 5.0), 1, 0));
    assertEquals(0, metrics.captured());
  }

  @Test
  void zeroAmountRejected() {
    producer.handlePostTransaction(successfulBuy(0));
    assertEquals(0, metrics.captured());
  }

  @Test
  void negativeAmountRejected() {
    producer.handlePostTransaction(successfulBuy(-3.0));
    assertEquals(0, metrics.captured());
  }

  @Test
  void duplicateSuppressed() {
    FakePostTransaction event = successfulBuy(5.0);
    producer.handlePostTransaction(event);
    producer.handlePostTransaction(event);
    assertEquals(1, metrics.captured());
    assertEquals(1, metrics.duplicateRejected());
  }

  private static FakePostTransaction successfulBuy(double price) {
    return successfulBuyWithPrices(Map.of("VAULT", price));
  }

  private static FakePostTransaction successfulBuyWithPrices(Map<String, Double> prices) {
    return new FakePostTransaction("BUY", "SUCCESS", prices, 1, priceFromMap(prices));
  }

  private static FakePostTransaction failedBuy(double price) {
    return new FakePostTransaction("BUY", "FAILED", Map.of("VAULT", price), 1, price);
  }

  private static FakePostTransaction cancelledBuy(double price) {
    return new FakePostTransaction("BUY", "CANCELLED", Map.of("VAULT", price), 1, price);
  }

  private static FakePostTransaction successfulSell(double price) {
    return new FakePostTransaction("SELL", "SUCCESS", Map.of("VAULT", price), 1, price);
  }

  private static double priceFromMap(Map<String, Double> prices) {
    return prices.values().stream().mapToDouble(Double::doubleValue).sum();
  }

  private void setRunning(boolean running) throws Exception {
    Field field = EconomyShopGuiBuyProducer.class.getDeclaredField("running");
    field.setAccessible(true);
    field.setBoolean(producer, running);
  }

  private static Plugin fakePlugin() {
    return (Plugin) Proxy.newProxyInstance(
        Plugin.class.getClassLoader(),
        new Class<?>[] {Plugin.class},
        (proxy, method, args) -> defaultValue(method.getReturnType()));
  }

  private static Player fakePlayer() {
    return (Player) Proxy.newProxyInstance(
        Player.class.getClassLoader(),
        new Class<?>[] {Player.class},
        (proxy, method, args) -> switch (method.getName()) {
          case "getUniqueId" -> PLAYER;
          case "getName" -> "Alex";
          default -> defaultValue(method.getReturnType());
        });
  }

  private static Object defaultValue(Class<?> type) {
    if (type == boolean.class) {
      return false;
    }
    if (type == int.class) {
      return 0;
    }
    if (type == long.class) {
      return 0L;
    }
    if (type == double.class) {
      return 0.0;
    }
    if (type == float.class) {
      return 0.0f;
    }
    return null;
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

  static final class FakePostTransaction {
    private final String type;
    private final String result;
    private final Map<String, Double> prices;
    private final int amount;
    private final double price;
    private final Player player;

    FakePostTransaction(String type, String result, Map<String, Double> prices, int amount, double price) {
      this.type = type;
      this.result = result;
      this.prices = prices;
      this.amount = amount;
      this.price = price;
      this.player = fakePlayer();
    }

    public String getTransactionType() {
      return type;
    }

    public String getTransactionResult() {
      return result;
    }

    public Player getPlayer() {
      return player;
    }

    public double getPrice() {
      return price;
    }

    public Map<String, Double> getPrices() {
      return new LinkedHashMap<>(prices);
    }

    public int getAmount() {
      return amount;
    }

    public Object getShopItem() {
      return null;
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
