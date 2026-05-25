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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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
 *
 * <p>Important future note: polling local balance snapshots is temporary
 * telemetry. The production gameplay economy sync path should become
 * transaction/event driven, or eventually a DB-backed Vault provider, so exact
 * causes and idempotency keys are known at the moment money changes.
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
  private final AtomicInteger exactMatches = new AtomicInteger();
  private final AtomicInteger positiveDeltas = new AtomicInteger();
  private final AtomicInteger negativeDeltas = new AtomicInteger();
  private final AtomicInteger ignoredDeltas = new AtomicInteger();
  private final AtomicInteger cappedDeltas = new AtomicInteger();
  private final AtomicInteger severeDeltas = new AtomicInteger();
  private final AtomicInteger skipped = new AtomicInteger();
  private final AtomicInteger failures = new AtomicInteger();
  private final AtomicLong totalAbsDelta = new AtomicLong();
  private final AtomicLong largestAbsDelta = new AtomicLong();
  private final AtomicLong largestPositiveDelta = new AtomicLong();
  private final AtomicLong largestNegativeDelta = new AtomicLong();
  private final AtomicLong lastRunAtMillis = new AtomicLong();
  private final AtomicLong lastRunDurationMillis = new AtomicLong();
  private final AtomicLong totalDbLatencyMillis = new AtomicLong();
  private final AtomicLong dbReadCount = new AtomicLong();
  private final AtomicLong lastDbLatencyMillis = new AtomicLong();
  private final AtomicLong totalVaultLatencyMillis = new AtomicLong();
  private final AtomicLong vaultReadCount = new AtomicLong();
  private final AtomicLong lastVaultLatencyMillis = new AtomicLong();
  private final VaultDeltaShadowAnalytics analytics = new VaultDeltaShadowAnalytics();
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

  public static boolean ignoredNoise(long deltaMinor, long minDeltaMinor, boolean ignoreNegativeOneMinorNoise) {
    return (ignoreNegativeOneMinorNoise && deltaMinor == -1L) || !shouldLogDelta(deltaMinor, minDeltaMinor);
  }

  public static DeltaSeverity classifyDelta(long deltaMinor, long warningDeltaMinor, long severeDeltaMinor) {
    long abs = Math.abs(deltaMinor);
    if (abs == 0) {
      return DeltaSeverity.MATCH;
    }
    if (abs >= Math.max(1, severeDeltaMinor)) {
      return DeltaSeverity.SEVERE;
    }
    if (abs >= Math.max(1, warningDeltaMinor)) {
      return DeltaSeverity.WARNING;
    }
    return DeltaSeverity.SMALL;
  }

  public static String estimatedSyncHealth(long matched, long severe, long warningOrSmall) {
    if (matched <= 0) {
      return "unknown";
    }
    if (severe > 0) {
      return "needs_review";
    }
    if (warningOrSmall > 0) {
      return "watch";
    }
    return "healthy";
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
      scheduleShadowSample();
    } catch (Throwable error) {
      recordFailure(error);
      runInProgress.set(false);
    }
  }

  private void scheduleShadowSample() {
    long runStarted = System.nanoTime();
    scheduler.runGlobal(() -> {
      try {
        if (!running.get()) {
          finishRun(runStarted);
          return;
        }
        List<PlayerSample> players = onlinePlayerSamples(config.economy().vaultDeltaShadowMaxPlayersPerRun());
        scheduler.runAsync(() -> runShadowSample(runStarted, players));
      } catch (Throwable error) {
        recordFailure(error);
        finishRun(runStarted);
      }
    });
  }

  private void runShadowSample(long runStarted, List<PlayerSample> players) {
    if (!running.get()) {
      finishRun(runStarted);
      return;
    }
    ProviderBinding binding = bindEconomyProvider();
    if (binding == null) {
      finishRun(runStarted);
      return;
    }

    if (players.isEmpty()) {
      finishRun(runStarted);
      return;
    }

    List<CompletableFuture<Void>> futures = new ArrayList<>();
    for (PlayerSample player : players) {
      sampled.incrementAndGet();
      TimedBalance vaultBalance = readVaultBalanceMinor(binding, player);
      if (vaultBalance == null) {
        skipped.incrementAndGet();
        continue;
      }
      long dbStarted = System.nanoTime();
      futures.add(economy.fetchBalance(player.uuid())
          .thenAccept(snapshot -> {
            recordDbLatency(dbStarted);
            observeDelta(player, binding.name(), vaultBalance.balanceMinor(), snapshot.balanceMinor());
          })
          .exceptionally(error -> {
            recordDbLatency(dbStarted);
            recordFailure(error);
            if (config.debug()) {
              logger.log(Level.WARNING, "Vault delta shadow DB balance read failed for " + player.uuid(), error);
            }
            return null;
          }));
    }

    if (futures.isEmpty()) {
      finishRun(runStarted);
      return;
    }

    CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new))
        .whenComplete((ignored, error) -> {
          if (error != null) {
            recordFailure(error);
          }
          finishRun(runStarted);
        });
  }

  private void finishRun(long runStartedNanos) {
    lastRunDurationMillis.set(elapsedMillis(runStartedNanos));
    lastRunAtMillis.set(System.currentTimeMillis());
    runInProgress.set(false);
  }

  private List<PlayerSample> onlinePlayerSamples(int limit) {
    Map<UUID, PlayerSample> unique = new LinkedHashMap<>();
    for (Player player : Bukkit.getOnlinePlayers()) {
      if (player == null || player.getUniqueId() == null) {
        continue;
      }
      unique.putIfAbsent(player.getUniqueId(), new PlayerSample(player.getUniqueId(), safeUsername(player.getName())));
      if (unique.size() >= limit) {
        break;
      }
    }
    return limitSamples(new ArrayList<>(unique.values()), limit);
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

  private TimedBalance readVaultBalanceMinor(ProviderBinding binding, PlayerSample player) {
    long started = System.nanoTime();
    try {
      OfflinePlayer offlinePlayer = Bukkit.getOfflinePlayer(player.uuid());
      Object result = binding.getBalance().invoke(binding.provider(), offlinePlayer);
      long latency = recordVaultLatency(started);
      if (result instanceof Number number && Double.isFinite(number.doubleValue())) {
        return new TimedBalance(toMinorUnits(number.doubleValue(), 100), latency);
      }
      return null;
    } catch (Throwable error) {
      recordVaultLatency(started);
      recordFailure(error);
      if (config.debug()) {
        logger.log(Level.WARNING, "Vault delta shadow Vault read failed for " + player.uuid(), error);
      }
      return null;
    }
  }

  private void observeDelta(PlayerSample player, String providerName, long vaultMinor, long dbMinor) {
    matched.incrementAndGet();
    long delta = deltaMinor(vaultMinor, dbMinor);
    long abs = Math.abs(delta);
    totalAbsDelta.addAndGet(abs);
    updateMax(largestAbsDelta, abs);
    if (delta > 0) {
      positiveDeltas.incrementAndGet();
      updateMax(largestPositiveDelta, delta);
    } else if (delta < 0) {
      negativeDeltas.incrementAndGet();
      updateMin(largestNegativeDelta, delta);
    } else {
      exactMatches.incrementAndGet();
    }

    EconomyConfig.ShadowConfig shadow = config.economy().shadow();
    DeltaSeverity severity = classifyDelta(delta, shadow.warningDeltaMinor(), shadow.severeDeltaMinor());
    boolean ignored = severity != DeltaSeverity.MATCH
        && ignoredNoise(delta, config.economy().vaultDeltaShadowMinDeltaMinor(), shadow.ignoreNegativeOneMinorNoise());
    if (ignored) {
      ignoredDeltas.incrementAndGet();
    }
    if (severity == DeltaSeverity.SEVERE) {
      severeDeltas.incrementAndGet();
    }
    if (abs > config.economy().vaultDeltaShadowMaxLoggedDeltaMinor()) {
      cappedDeltas.incrementAndGet();
    }

    Observation observation = new Observation(
        player.uuid(),
        player.username(),
        dbMinor,
        vaultMinor,
        delta,
        Instant.now(),
        config.serverId(),
        config.serverGroup(),
        severity,
        ignored
    );
    analytics.record(observation, shadow.observationCacheSize());

    if (ignored || severity == DeltaSeverity.MATCH) {
      return;
    }

    String logLine = structuredLogLine(observation, providerName);
    if (severity == DeltaSeverity.SEVERE) {
      logger.warning("Vault delta shadow severe " + logLine);
    } else {
      logger.info("Vault delta shadow " + logLine);
    }
  }

  private String structuredLogLine(Observation observation, String providerName) {
    return "timestamp=" + observation.timestamp()
        + " backend=" + observation.backendId()
        + " serverGroup=" + observation.serverGroup()
        + " uuid=" + observation.uuid()
        + " username=" + observation.username()
        + " dbBalanceMinor=" + observation.dbBalanceMinor()
        + " vaultBalanceMinor=" + observation.vaultBalanceMinor()
        + " deltaMinor=" + observation.deltaMinor()
        + " severity=" + observation.severity()
        + " sampleSource=online"
        + " provider=" + providerName
        + " shadowOnly=true";
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

  private long recordVaultLatency(long startedNanos) {
    long elapsed = elapsedMillis(startedNanos);
    lastVaultLatencyMillis.set(elapsed);
    totalVaultLatencyMillis.addAndGet(elapsed);
    vaultReadCount.incrementAndGet();
    return elapsed;
  }

  private void recordDbLatency(long startedNanos) {
    long elapsed = elapsedMillis(startedNanos);
    lastDbLatencyMillis.set(elapsed);
    totalDbLatencyMillis.addAndGet(elapsed);
    dbReadCount.incrementAndGet();
  }

  private static long elapsedMillis(long startedNanos) {
    return Math.max(0, (System.nanoTime() - startedNanos) / 1_000_000L);
  }

  private static void updateMax(AtomicLong target, long value) {
    long current;
    do {
      current = target.get();
      if (value <= current) {
        return;
      }
    } while (!target.compareAndSet(current, value));
  }

  private static void updateMin(AtomicLong target, long value) {
    long current;
    do {
      current = target.get();
      if (current != 0 && value >= current) {
        return;
      }
    } while (!target.compareAndSet(current, value));
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

  private void recordFailure(Throwable error) {
    failures.incrementAndGet();
    lastFailure = safeMessage(error);
    if (config.debug()) {
      logger.log(Level.WARNING, "Vault delta shadow run failed", error);
    }
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

  public int exactMatchCount() {
    return exactMatches.get();
  }

  public int deltaCount() {
    return positiveDeltas.get() + negativeDeltas.get();
  }

  public int positiveDeltaCount() {
    return positiveDeltas.get();
  }

  public int negativeDeltaCount() {
    return negativeDeltas.get();
  }

  public int ignoredDeltaCount() {
    return ignoredDeltas.get();
  }

  public int cappedDeltaCount() {
    return cappedDeltas.get();
  }

  public int severeDeltaCount() {
    return severeDeltas.get();
  }

  public long averageAbsDeltaMinor() {
    long count = matched.get();
    return count <= 0 ? 0 : totalAbsDelta.get() / count;
  }

  public long largestAbsDeltaMinor() {
    return largestAbsDelta.get();
  }

  public long largestPositiveDeltaMinor() {
    return largestPositiveDelta.get();
  }

  public long largestNegativeDeltaMinor() {
    return largestNegativeDelta.get();
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

  public long lastRunDurationMillis() {
    return lastRunDurationMillis.get();
  }

  public long averageDbReadLatencyMillis() {
    long count = dbReadCount.get();
    return count <= 0 ? 0 : totalDbLatencyMillis.get() / count;
  }

  public long averageVaultReadLatencyMillis() {
    long count = vaultReadCount.get();
    return count <= 0 ? 0 : totalVaultLatencyMillis.get() / count;
  }

  public long lastDbReadLatencyMillis() {
    return lastDbLatencyMillis.get();
  }

  public long lastVaultReadLatencyMillis() {
    return lastVaultLatencyMillis.get();
  }

  public int recentObservationCount() {
    return analytics.size();
  }

  public List<OffenderSummary> topOffenders(int limit) {
    return analytics.topOffenders(limit, config.economy().shadow().repeatedOffenderThreshold());
  }

  public String estimatedSyncHealth() {
    return estimatedSyncHealth(matched.get(), severeDeltas.get(), deltaCount());
  }

  public String lastFailure() {
    return lastFailure;
  }

  private record ProviderBinding(Object provider, String name, Method getBalance) {}

  private record TimedBalance(long balanceMinor, long latencyMillis) {}

  public record PlayerSample(UUID uuid, String username) {}

  public enum DeltaSeverity {
    MATCH,
    SMALL,
    WARNING,
    SEVERE
  }

  public record Observation(
      UUID uuid,
      String username,
      long dbBalanceMinor,
      long vaultBalanceMinor,
      long deltaMinor,
      Instant timestamp,
      String backendId,
      String serverGroup,
      DeltaSeverity severity,
      boolean ignored
  ) {}

  public record OffenderSummary(UUID uuid, int count, String username) {}
}
