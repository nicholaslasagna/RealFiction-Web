package com.realfiction.realcore.economy;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.config.EconomyConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.entity.Player;
import org.bukkit.plugin.RegisteredServiceProvider;

/**
 * Shadow-only DB-vs-Vault balance observer.
 *
 * <p>This service never writes the economy ledger, never mutates Vault or
 * EssentialsX, and never touches reward acknowledgements. It samples online
 * players only, reads local Vault balances, reads DB balances through the
 * existing HMAC economy balance API, and logs observed deltas for rollout
 * analysis.
 */
public final class VaultDeltaShadowService {
  private static final String ECONOMY_CLASS = "net.milkbowl.vault.economy.Economy";

  private final RealCorePlugin plugin;
  private final RealCoreConfig config;
  private final EconomyService economy;
  private final RealCoreScheduler scheduler;
  private final Logger logger;

  private final AtomicBoolean running = new AtomicBoolean(false);
  private final AtomicBoolean runInProgress = new AtomicBoolean(false);
  private final AtomicBoolean warnedMissingVault = new AtomicBoolean(false);
  private final AtomicInteger sampled = new AtomicInteger();
  private final AtomicInteger matched = new AtomicInteger();
  private final AtomicInteger deltaCount = new AtomicInteger();
  private final AtomicInteger skipped = new AtomicInteger();
  private final AtomicInteger failures = new AtomicInteger();
  private final AtomicLong lastRunAtMillis = new AtomicLong();
  private volatile String lastFailure = "";
  private ScheduledTaskHandle handle;

  public VaultDeltaShadowService(RealCorePlugin plugin, RealCoreConfig config,
                                 EconomyService economy, RealCoreScheduler scheduler, Logger logger) {
    this.plugin = Objects.requireNonNull(plugin, "plugin");
    this.config = Objects.requireNonNull(config, "config");
    this.economy = Objects.requireNonNull(economy, "economy");
    this.scheduler = Objects.requireNonNull(scheduler, "scheduler");
    this.logger = Objects.requireNonNull(logger, "logger");
  }

  public void start() {
    String guard = guardReason(config);
    if (!guard.isBlank()) {
      if (config.economy().vaultDeltaShadowEnabled()) {
        logger.info("Vault delta shadow observer disabled: " + guard);
      }
      return;
    }
    if (!running.compareAndSet(false, true)) {
      return;
    }
    long interval = config.economy().vaultDeltaShadowInterval().toSeconds();
    handle = scheduler.runAsyncRepeating(this::tickSafely, Math.min(30, interval), interval);
  }

  public void stop() {
    if (!running.compareAndSet(true, false)) {
      return;
    }
    if (handle != null) {
      handle.cancel();
      handle = null;
    }
  }

  public static String guardReason(RealCoreConfig config) {
    if (config == null) {
      return "config is not loaded";
    }
    EconomyConfig economy = config.economy();
    if (!config.modules().economy()) {
      return "modules.economy is false";
    }
    if (!economy.enabled()) {
      return "economy.enabled is false";
    }
    if (!economy.vaultDeltaShadowEnabled()) {
      return "economy.vaultDeltaShadowEnabled is false";
    }
    if ("anarchy".equalsIgnoreCase(config.serverGroup())) {
      return "Anarchy is blocked from economy shadow observation";
    }
    String serverId = config.serverId() == null ? "" : config.serverId().toLowerCase(Locale.ROOT);
    if (!economy.vaultDeltaShadowBackendAllowlist().contains(serverId)) {
      return "server.id is not in economy.vaultDeltaShadowBackendAllowlist";
    }
    return "";
  }

  public static long deltaMinor(long vaultBalanceMinor, long dbBalanceMinor) {
    return vaultBalanceMinor - dbBalanceMinor;
  }

  public static boolean shouldLogDelta(long deltaMinor, long minDeltaMinor) {
    return Math.abs(deltaMinor) >= Math.max(0, minDeltaMinor);
  }

  public static <T> List<T> limitSamples(List<T> samples, int limit) {
    int normalized = Math.max(0, limit);
    if (samples.size() <= normalized) {
      return samples;
    }
    return List.copyOf(samples.subList(0, normalized));
  }

  private void tickSafely() {
    if (!running.get()) {
      return;
    }
    if (!runInProgress.compareAndSet(false, true)) {
      skipped.incrementAndGet();
      return;
    }

    try {
      runShadowSample();
    } catch (Throwable error) {
      failures.incrementAndGet();
      lastFailure = safeMessage(error);
      runInProgress.set(false);
      if (config.debug()) {
        logger.log(Level.WARNING, "Vault delta shadow run crashed", error);
      } else {
        logger.warning("Vault delta shadow run failed: " + safeMessage(error));
      }
    }
  }

  private void runShadowSample() {
    ProviderBinding binding = bindEconomyProvider();
    if (binding == null) {
      runInProgress.set(false);
      return;
    }

    List<PlayerSample> players = onlinePlayerSamples(config.economy().vaultDeltaShadowMaxPlayersPerRun());
    if (players.isEmpty()) {
      lastRunAtMillis.set(System.currentTimeMillis());
      runInProgress.set(false);
      return;
    }

    List<CompletableFuture<Void>> futures = new ArrayList<>();
    for (PlayerSample player : players) {
      sampled.incrementAndGet();
      Long vaultMinor = readVaultBalanceMinor(binding, player);
      if (vaultMinor == null) {
        skipped.incrementAndGet();
        continue;
      }
      futures.add(economy.fetchBalance(player.uuid())
          .thenAccept(snapshot -> observeDelta(player, binding.name(), vaultMinor, snapshot.balanceMinor()))
          .exceptionally(error -> {
            failures.incrementAndGet();
            lastFailure = safeMessage(error);
            if (config.debug()) {
              logger.log(Level.WARNING, "Vault delta shadow DB balance read failed for " + player.uuid(), error);
            }
            return null;
          }));
    }

    if (futures.isEmpty()) {
      lastRunAtMillis.set(System.currentTimeMillis());
      runInProgress.set(false);
      return;
    }

    CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new))
        .whenComplete((ignored, error) -> {
          if (error != null) {
            failures.incrementAndGet();
            lastFailure = safeMessage(error);
          }
          lastRunAtMillis.set(System.currentTimeMillis());
          runInProgress.set(false);
        });
  }

  private List<PlayerSample> onlinePlayerSamples(int limit) {
    List<PlayerSample> players = new ArrayList<>();
    for (Player player : Bukkit.getOnlinePlayers()) {
      if (player == null || player.getUniqueId() == null) {
        continue;
      }
      players.add(new PlayerSample(player.getUniqueId(), safeUsername(player.getName())));
      if (players.size() >= limit) {
        break;
      }
    }
    return limitSamples(players, limit);
  }

  private ProviderBinding bindEconomyProvider() {
    Class<?> economyClass;
    try {
      economyClass = Class.forName(ECONOMY_CLASS);
    } catch (ClassNotFoundException missing) {
      warnMissingVault("Vault is not installed; Vault delta shadow observer is dormant.");
      return null;
    }
    RegisteredServiceProvider<?> registration = Bukkit.getServicesManager().getRegistration(economyClass);
    if (registration == null || registration.getProvider() == null) {
      warnMissingVault("Vault Economy provider not registered; Vault delta shadow observer is dormant.");
      return null;
    }
    Object provider = registration.getProvider();
    try {
      Method getBalance = provider.getClass().getMethod("getBalance", OfflinePlayer.class);
      return new ProviderBinding(provider, providerName(provider), getBalance);
    } catch (NoSuchMethodException error) {
      failures.incrementAndGet();
      lastFailure = "Vault Economy provider has no getBalance(OfflinePlayer)";
      logger.log(Level.WARNING, lastFailure, error);
      return null;
    }
  }

  private void warnMissingVault(String message) {
    if (warnedMissingVault.compareAndSet(false, true)) {
      logger.warning(message);
    }
  }

  private Long readVaultBalanceMinor(ProviderBinding binding, PlayerSample player) {
    try {
      OfflinePlayer offlinePlayer = Bukkit.getOfflinePlayer(player.uuid());
      Object result = binding.getBalance().invoke(binding.provider(), offlinePlayer);
      if (result instanceof Number number && Double.isFinite(number.doubleValue())) {
        return toMinorUnits(number.doubleValue(), 100);
      }
      return null;
    } catch (Throwable error) {
      failures.incrementAndGet();
      lastFailure = safeMessage(error);
      if (config.debug()) {
        logger.log(Level.WARNING, "Vault delta shadow Vault read failed for " + player.uuid(), error);
      }
      return null;
    }
  }

  private void observeDelta(PlayerSample player, String providerName, long vaultMinor, long dbMinor) {
    matched.incrementAndGet();
    long delta = deltaMinor(vaultMinor, dbMinor);
    long min = config.economy().vaultDeltaShadowMinDeltaMinor();
    if (!shouldLogDelta(delta, min)) {
      return;
    }

    deltaCount.incrementAndGet();
    long max = config.economy().vaultDeltaShadowMaxLoggedDeltaMinor();
    String flag = Math.abs(delta) > max ? " over_cap=true" : "";
    logger.info("Vault delta shadow: serverId=" + config.serverId()
        + " serverGroup=" + config.serverGroup()
        + " uuid=" + player.uuid()
        + " username=" + player.username()
        + " vaultMinor=" + vaultMinor
        + " dbMinor=" + dbMinor
        + " deltaMinor=" + delta
        + " provider=" + providerName
        + " observedAt=" + Instant.now()
        + flag
        + " shadowOnly=true");
  }

  private static long toMinorUnits(double vaultBalance, int scale) {
    return BigDecimal.valueOf(vaultBalance)
        .multiply(BigDecimal.valueOf(Math.max(1, scale)))
        .setScale(0, RoundingMode.HALF_UP)
        .longValue();
  }

  private String providerName(Object provider) {
    try {
      Method getName = provider.getClass().getMethod("getName");
      Object name = getName.invoke(provider);
      if (name instanceof String string && !string.isBlank()) {
        return string;
      }
    } catch (Throwable ignored) {
      // Provider class name is enough for local telemetry.
    }
    return provider.getClass().getName();
  }

  private static String safeUsername(String username) {
    return username == null || username.isBlank() ? "unknown" : username.replaceAll("[^A-Za-z0-9_]", "_");
  }

  private static String safeMessage(Throwable error) {
    if (error == null || error.getMessage() == null || error.getMessage().isBlank()) {
      return error == null ? "unknown" : error.getClass().getSimpleName();
    }
    return error.getMessage();
  }

  public boolean running() {
    return running.get();
  }

  public int sampledCount() {
    return sampled.get();
  }

  public int matchedCount() {
    return matched.get();
  }

  public int deltaCount() {
    return deltaCount.get();
  }

  public int skippedCount() {
    return skipped.get();
  }

  public int failureCount() {
    return failures.get();
  }

  public long lastRunAgoSeconds() {
    long at = lastRunAtMillis.get();
    return at <= 0 ? -1 : Math.max(0, (System.currentTimeMillis() - at) / 1000);
  }

  public String lastFailure() {
    return lastFailure;
  }

  private record ProviderBinding(Object provider, String name, Method getBalance) {}

  public record PlayerSample(UUID uuid, String username) {}
}
