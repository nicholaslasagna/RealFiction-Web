package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.api.PlatformApiException;
import com.realfiction.realcore.api.dto.EconomyBalanceRequest;
import com.realfiction.realcore.api.dto.EconomyBalanceResponse;
import com.realfiction.realcore.api.dto.EconomyTransactionsRequest;
import com.realfiction.realcore.api.dto.EconomyTransactionsResponse;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.lang.reflect.Field;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;

final class EconomyServiceBalanceReadTest {
  private static final UUID PLAYER_UUID = UUID.fromString("11111111-1111-1111-1111-111111111111");

  @Test
  void dbBalanceReadRequiresExplicitEnablementAndAllowlist() throws InvalidConfigurationException {
    assertEquals("economy.dbBalanceReadEnabled is false",
        EconomyService.dbBalanceReadGuardReason(config("smp-1", "smp", true, false, false, "smp-1", 30)));

    assertEquals("server.id is not in economy.dbBalanceReadBackendAllowlist",
        EconomyService.dbBalanceReadGuardReason(config("factions-1", "factions", true, false, true, "smp-1", 30)));

    assertEquals("",
        EconomyService.dbBalanceReadGuardReason(config("smp-1", "smp", true, false, true, "smp-1", 30)));
  }

  @Test
  void dbBalanceReadBlocksAnarchyEvenWhenAllowlisted() throws InvalidConfigurationException {
    assertEquals("Anarchy is blocked from DB economy balance reads",
        EconomyService.dbBalanceReadGuardReason(config("anarchy-1", "anarchy", true, false, true, "anarchy-1", 30)));
  }

  @Test
  void successfulDbBalanceReadIsCachedAndDoesNotCallWriteTransport() throws Exception {
    AtomicInteger readCalls = new AtomicInteger();
    AtomicInteger writeCalls = new AtomicInteger();
    EconomyService service = service(
        config("smp-1", "smp", true, false, true, "smp-1", 30),
        request -> {
          readCalls.incrementAndGet();
          return CompletableFuture.completedFuture(response(request, 12_345));
        },
        request -> {
          writeCalls.incrementAndGet();
          return CompletableFuture.completedFuture(new EconomyTransactionsResponse());
        });

    service.start();

    EconomyBalanceSnapshot first = service.fetchBalanceReadOnly(PLAYER_UUID).join();
    EconomyBalanceSnapshot second = service.fetchBalanceReadOnly(PLAYER_UUID).join();

    assertTrue(service.running());
    assertFalse(service.writerRunning());
    assertEquals(12_345, first.balanceMinor());
    assertEquals(first, second);
    assertEquals(1, readCalls.get());
    assertEquals(0, writeCalls.get());
    assertEquals(1, service.cachedBalanceCount());
    assertEquals(1, service.balanceReadSuccessCount());
    assertEquals(0, service.balanceReadFailureCount());
  }

  @Test
  void expiredCacheRefetchesBalance() throws Exception {
    AtomicInteger readCalls = new AtomicInteger();
    EconomyService service = service(
        config("smp-1", "smp", true, false, true, "smp-1", 30),
        request -> {
          int call = readCalls.incrementAndGet();
          return CompletableFuture.completedFuture(response(request, call == 1 ? 100 : 200));
        },
        request -> CompletableFuture.completedFuture(new EconomyTransactionsResponse()));
    service.start();

    EconomyBalanceSnapshot first = service.fetchBalanceReadOnly(PLAYER_UUID).join();
    assertEquals(100, first.balanceMinor());

    EconomyBalanceSnapshot stale = new EconomyBalanceSnapshot(
        "realfiction_main",
        PLAYER_UUID,
        "Alex",
        50,
        100,
        Instant.now(),
        Instant.now().minusSeconds(120));
    putCachedBalance(service, PLAYER_UUID, stale);

    EconomyBalanceSnapshot refreshed = service.fetchBalanceReadOnly(PLAYER_UUID).join();

    assertEquals(200, refreshed.balanceMinor());
    assertEquals(2, readCalls.get());
  }

  @Test
  void canReadPolicyFailureIsCountedAndFailsSafely() throws Exception {
    EconomyService service = service(
        config("smp-1", "smp", true, false, true, "smp-1", 30),
        request -> failedFuture(new PlatformApiException("HTTP 403", 403)),
        request -> CompletableFuture.completedFuture(new EconomyTransactionsResponse()));
    service.start();

    CompletionException error = assertThrows(CompletionException.class,
        () -> service.fetchBalanceReadOnly(PLAYER_UUID).join());

    assertTrue(error.getCause() instanceof PlatformApiException);
    assertEquals(0, service.balanceReadSuccessCount());
    assertEquals(1, service.balanceReadFailureCount());
    assertEquals(0, service.cachedBalanceCount());
  }

  private static EconomyService service(RealCoreConfig config, EconomyBalanceTransport balanceTransport,
                                        EconomyTransactionsTransport transactionsTransport) {
    return new EconomyService(config, new NoopScheduler(), balanceTransport, transactionsTransport, Logger.getLogger("test"));
  }

  private static RealCoreConfig config(String serverId, String serverGroup, boolean moduleEnabled,
                                       boolean economyEnabled, boolean dbReadEnabled, String allowlistedServerId,
                                       int cacheSeconds)
      throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        baseUrl: "https://realfiction.test"
        server:
          id: "%s"
          group: "%s"
          displayName: "Test"
        hmacSecret: "test-secret"
        modules:
          economy: %s
        economy:
          enabled: %s
          currencyKey: "realfiction_main"
          dbBalanceReadEnabled: %s
          dbBalanceReadBackendAllowlist:
            - "%s"
          dbBalanceReadCacheSeconds: %d
        """.formatted(serverId, serverGroup, moduleEnabled, economyEnabled, dbReadEnabled, allowlistedServerId, cacheSeconds));
    return RealCoreConfig.from(yaml);
  }

  private static EconomyBalanceResponse response(EconomyBalanceRequest request, long balanceMinor) {
    EconomyBalanceResponse response = new EconomyBalanceResponse();
    response.currencyKey = request.currencyKey;
    response.minecraftUuid = request.minecraftUuid;
    response.minecraftUsername = "Alex";
    response.balanceMinor = balanceMinor;
    response.scale = 100;
    response.updatedAt = Instant.now().toString();
    return response;
  }

  @SuppressWarnings("unchecked")
  private static void putCachedBalance(EconomyService service, UUID uuid, EconomyBalanceSnapshot snapshot) throws Exception {
    Field field = EconomyService.class.getDeclaredField("balanceCache");
    field.setAccessible(true);
    Map<UUID, EconomyBalanceSnapshot> cache = (Map<UUID, EconomyBalanceSnapshot>) field.get(service);
    cache.put(uuid, snapshot);
  }

  private static <T> CompletableFuture<T> failedFuture(Throwable error) {
    CompletableFuture<T> future = new CompletableFuture<>();
    future.completeExceptionally(error);
    return future;
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
    @Override public CompletableFuture<Void> dispatchConsoleCommand(String command) {
      return CompletableFuture.completedFuture(null);
    }
    @Override public void send(CommandSender sender, String message) {
      sender.sendMessage(message);
    }
    @Override public void close() {}
  }
}
