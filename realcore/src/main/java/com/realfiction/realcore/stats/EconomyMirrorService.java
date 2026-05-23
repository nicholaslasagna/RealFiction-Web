package com.realfiction.realcore.stats;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.lang.reflect.Method;
import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Level;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.entity.Player;
import org.bukkit.plugin.RegisteredServiceProvider;

/**
 * Periodically mirrors player economy balances into {@code money.total} via the
 * stat writer ({@code set} mode). Vault is accessed reflectively so RealCore
 * compiles and runs whether or not Vault is on the server. When Vault or the
 * Economy provider is missing, the service logs once and no-ops.
 *
 * <p>Folia-safe: the periodic task runs on the async scheduler.
 * {@code Bukkit.getOnlinePlayers()} and {@code Bukkit.getOfflinePlayer(UUID)}
 * are documented as safe to call from any thread on Paper/Folia. We only read
 * primitive identifiers from {@link Player} (uuid, name) which are immutable
 * for the connection lifetime, then hand them to the writer.
 *
 * <p>{@code money.total} is intentionally <em>not</em> in the public stat
 * leaderboard allowlist: balances are sensitive operational data and only the
 * authenticated plugin route can read them.
 */
public final class EconomyMirrorService {
  private static final String ECONOMY_CLASS = "net.milkbowl.vault.economy.Economy";

  private final RealCorePlugin plugin;
  private final NetworkStatWriter writer;
  private final RealCoreScheduler scheduler;
  private final Duration interval;

  private final AtomicBoolean running = new AtomicBoolean(false);
  private final AtomicBoolean warnedMissing = new AtomicBoolean(false);
  private final AtomicReference<Object> economyProvider = new AtomicReference<>();
  private final AtomicReference<Method> getBalanceMethod = new AtomicReference<>();
  private final AtomicInteger mirroredPlayerCount = new AtomicInteger();
  private final AtomicInteger failureCount = new AtomicInteger();
  private final AtomicLong lastMirrorAtMillis = new AtomicLong();
  private ScheduledTaskHandle handle;

  public EconomyMirrorService(RealCorePlugin plugin, NetworkStatWriter writer,
                              RealCoreScheduler scheduler, Duration interval) {
    this.plugin = Objects.requireNonNull(plugin, "plugin");
    this.writer = Objects.requireNonNull(writer, "writer");
    this.scheduler = Objects.requireNonNull(scheduler, "scheduler");
    this.interval = Objects.requireNonNull(interval, "interval");
  }

  public void start() {
    if (!running.compareAndSet(false, true)) {
      return;
    }
    long seconds = Math.max(60, interval.toSeconds());
    // First mirror after 30s to let the server warm up; then every interval.
    handle = scheduler.runAsyncRepeating(this::tick, 30, seconds);
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

  // ---- Observability ------------------------------------------------------

  public boolean running() {
    return running.get();
  }

  public boolean economyAvailable() {
    return economyProvider.get() != null;
  }

  public int mirroredPlayerCount() {
    return mirroredPlayerCount.get();
  }

  public int failureCount() {
    return failureCount.get();
  }

  public long lastMirrorAgoSeconds() {
    long stamp = lastMirrorAtMillis.get();
    return stamp == 0L ? -1L : (System.currentTimeMillis() - stamp) / 1000L;
  }

  public long intervalSeconds() {
    return interval.toSeconds();
  }

  // ---- Tick ---------------------------------------------------------------

  private void tick() {
    if (!running.get()) {
      return;
    }
    Object provider = ensureEconomyProvider();
    if (provider == null) {
      return;
    }
    Method method = ensureGetBalanceMethod(provider);
    if (method == null) {
      return;
    }

    int mirrored = 0;
    for (Player player : Bukkit.getOnlinePlayers()) {
      if (player == null) {
        continue;
      }
      OfflinePlayer offline = Bukkit.getOfflinePlayer(player.getUniqueId());
      Double balance = invokeGetBalance(method, provider, offline);
      if (balance == null) {
        continue;
      }
      writer.set("money.total", player.getUniqueId(), player.getName(), balance);
      mirrored++;
    }
    if (mirrored > 0) {
      mirroredPlayerCount.addAndGet(mirrored);
      lastMirrorAtMillis.set(System.currentTimeMillis());
    }
  }

  private Object ensureEconomyProvider() {
    Object cached = economyProvider.get();
    if (cached != null) {
      return cached;
    }
    Class<?> economyClass;
    try {
      economyClass = Class.forName(ECONOMY_CLASS);
    } catch (ClassNotFoundException missing) {
      if (warnedMissing.compareAndSet(false, true)) {
        plugin.getLogger().warning("Vault is not installed; money.total mirror is dormant.");
      }
      return null;
    }
    RegisteredServiceProvider<?> registration = Bukkit.getServicesManager().getRegistration(economyClass);
    if (registration == null) {
      if (warnedMissing.compareAndSet(false, true)) {
        plugin.getLogger().warning("Vault Economy provider not registered; money.total mirror is dormant.");
      }
      return null;
    }
    Object provider = registration.getProvider();
    if (provider == null) {
      return null;
    }
    economyProvider.set(provider);
    plugin.getLogger().info("EconomyMirrorService bound to Vault provider "
        + provider.getClass().getName() + " (" + interval.toSeconds() + "s interval)");
    return provider;
  }

  private Method ensureGetBalanceMethod(Object provider) {
    Method cached = getBalanceMethod.get();
    if (cached != null) {
      return cached;
    }
    try {
      Method method = provider.getClass().getMethod("getBalance", OfflinePlayer.class);
      getBalanceMethod.set(method);
      return method;
    } catch (NoSuchMethodException error) {
      plugin.getLogger().log(Level.WARNING, "Vault Economy provider has no getBalance(OfflinePlayer)", error);
      return null;
    }
  }

  private Double invokeGetBalance(Method method, Object provider, OfflinePlayer player) {
    try {
      Object result = method.invoke(provider, player);
      if (result instanceof Number number) {
        double value = number.doubleValue();
        return Double.isFinite(value) ? value : null;
      }
      return null;
    } catch (Throwable error) {
      failureCount.incrementAndGet();
      if (failureCount.get() <= 3) {
        plugin.getLogger().log(Level.WARNING,
            "Vault getBalance threw for " + (player == null ? "?" : player.getUniqueId()), error);
      }
      return null;
    }
  }
}
