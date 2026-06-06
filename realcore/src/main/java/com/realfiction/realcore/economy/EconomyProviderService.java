package com.realfiction.realcore.economy;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.config.EconomyProviderConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.plugin.RegisteredServiceProvider;

/**
 * Backing service for making RealCore the network's Vault economy provider (Phase 1: shadow).
 *
 * <p>It owns the authoritative {@link EconomyBalanceCache}, preloads a player's balance from the
 * shared Supabase store on join (on the async pre-login thread, so it may block briefly), and — in
 * shadow mode — logs that value next to the current EssentialsX balance so an operator can confirm
 * RealCore tracks reality on both Purpur and Folia <em>before</em> any money moves or any provider
 * registration happens. Registering as the live Vault provider + write-through is a later phase
 * that builds on this same cache.
 */
public final class EconomyProviderService {
  private static final String ECONOMY_CLASS = "net.milkbowl.vault.economy.Economy";

  private final RealCorePlugin plugin;
  private final RealCoreConfig config;
  private final EconomyService economy;
  private final RealCoreScheduler scheduler;
  private final Logger logger;
  private final EconomyBalanceCache cache = new EconomyBalanceCache();
  private final Set<String> warnedKeys = ConcurrentHashMap.newKeySet();
  private final AtomicBoolean running = new AtomicBoolean(false);

  private volatile Object essentialsProvider;
  private volatile Method essentialsGetBalance;

  private final AtomicLong preloads = new AtomicLong();
  private final AtomicLong preloadFailures = new AtomicLong();
  private final AtomicLong shadowMatches = new AtomicLong();
  private final AtomicLong shadowMismatches = new AtomicLong();

  public EconomyProviderService(
      RealCorePlugin plugin,
      RealCoreConfig config,
      EconomyService economy,
      RealCoreScheduler scheduler,
      Logger logger
  ) {
    this.plugin = plugin;
    this.config = config;
    this.economy = economy;
    this.scheduler = scheduler;
    this.logger = logger == null ? Logger.getLogger("RealCore") : logger;
  }

  // -- lifecycle --------------------------------------------------------------

  public void start() {
    String guard = guardReason();
    if (!guard.isBlank()) {
      logger.info("Economy provider disabled: " + guard);
      return;
    }
    running.set(true);
    EconomyProviderConfig pc = providerConfig();
    if (pc.shadowMode()) {
      logger.info("Economy provider enabled in SHADOW mode (currency=" + pc.currencyNamePlural()
          + ", failClosed=" + pc.failClosed()
          + "). Observing only: preloading balances and logging DB-vs-EssentialsX deltas, "
          + "not registering as the Vault provider and not moving money.");
    } else {
      // Phase 1 jar: live registration is intentionally not wired yet. Stay safe.
      logger.warning("Economy provider has shadowMode=false, but live Vault registration is not "
          + "available in this build yet — staying in observe-only mode. Keep shadowMode=true.");
    }
  }

  public void stop() {
    running.set(false);
    essentialsProvider = null;
    essentialsGetBalance = null;
  }

  public boolean enabled() {
    return running.get();
  }

  public boolean shadowMode() {
    return providerConfig().shadowMode();
  }

  public EconomyBalanceCache cache() {
    return cache;
  }

  // -- preload / quit ---------------------------------------------------------

  /**
   * Preload a player's authoritative balance. Intended to be called from {@code
   * AsyncPlayerPreLoginEvent}, which already runs off the main thread and may block. On failure the
   * account is marked FAILED so the (future) live provider fails closed instead of serving zero.
   */
  public void preloadBlocking(UUID uuid, String name) {
    if (!running.get() || uuid == null) {
      return;
    }
    if (!guardReason().isBlank()) {
      return;
    }
    try {
      EconomyBalanceSnapshot snapshot = economy.fetchBalanceReadOnly(uuid).get(5, TimeUnit.SECONDS);
      if (snapshot == null) {
        cache.markFailed(uuid);
        preloadFailures.incrementAndGet();
        return;
      }
      cache.putLoaded(uuid, snapshot.balanceMinor());
      preloads.incrementAndGet();
      if (providerConfig().shadowMode() && scheduler != null) {
        scheduler.runGlobal(() -> shadowCompare(uuid, name, snapshot.balanceMinor(), snapshot.scale()));
      }
    } catch (Exception error) {
      cache.markFailed(uuid);
      preloadFailures.incrementAndGet();
      warnOnce("preload", "Balance preload failed for " + name + " (" + uuid + "): " + rootMessage(error));
    }
  }

  public void onQuit(UUID uuid) {
    if (uuid != null) {
      cache.evict(uuid);
    }
  }

  private void shadowCompare(UUID uuid, String name, long dbMinor, int scale) {
    try {
      Double essentials = readEssentialsBalance(uuid);
      if (essentials == null) {
        logger.info("[EconomyProvider:SHADOW] name=" + name + " uuid=" + uuid
            + " dbMinor=" + dbMinor + " essentials=unavailable");
        return;
      }
      long essentialsMinor = toMinorUnits(essentials, scale);
      long delta = dbMinor - essentialsMinor;
      if (delta == 0) {
        shadowMatches.incrementAndGet();
      } else {
        shadowMismatches.incrementAndGet();
      }
      logger.info("[EconomyProvider:SHADOW] name=" + name + " uuid=" + uuid
          + " dbMinor=" + dbMinor + " essentialsMinor=" + essentialsMinor + " deltaMinor=" + delta);
    } catch (Throwable error) {
      warnOnce("shadow", "Shadow compare failed: " + rootMessage(error));
    }
  }

  // -- EssentialsX read (reflection; provider stays unregistered in Phase 1) ---

  private Double readEssentialsBalance(UUID uuid) {
    Method getBalance = bindEssentials();
    if (getBalance == null) {
      return null;
    }
    try {
      OfflinePlayer player = Bukkit.getOfflinePlayer(uuid);
      Object result = getBalance.invoke(essentialsProvider, player);
      if (result instanceof Number number && Double.isFinite(number.doubleValue())) {
        return number.doubleValue();
      }
    } catch (Throwable error) {
      warnOnce("essentials", "Could not read EssentialsX balance: " + rootMessage(error));
    }
    return null;
  }

  private Method bindEssentials() {
    Method cached = essentialsGetBalance;
    if (cached != null) {
      return cached;
    }
    try {
      Class<?> economyClass = Class.forName(ECONOMY_CLASS);
      RegisteredServiceProvider<?> registration = Bukkit.getServicesManager().getRegistration(economyClass);
      if (registration == null || registration.getProvider() == null) {
        return null;
      }
      Object provider = registration.getProvider();
      Method getBalance = provider.getClass().getMethod("getBalance", OfflinePlayer.class);
      essentialsProvider = provider;
      essentialsGetBalance = getBalance;
      return getBalance;
    } catch (ClassNotFoundException | NoSuchMethodException error) {
      return null;
    }
  }

  // -- guards / status --------------------------------------------------------

  private EconomyProviderConfig providerConfig() {
    return config.economy().provider();
  }

  String guardReason() {
    if (config == null || economy == null) {
      return "economy is not loaded";
    }
    if (!config.modules().economy()) {
      return "modules.economy is false";
    }
    if (!config.economy().enabled()) {
      return "economy.enabled is false";
    }
    if (!providerConfig().enabled()) {
      return "economy.provider.enabled is false";
    }
    if ("anarchy".equalsIgnoreCase(config.serverGroup())) {
      return "anarchy may not host the global economy";
    }
    if (!providerConfig().allows(config.serverId())) {
      return "server.id is not in economy.provider.backendAllowlist";
    }
    String dbReadGuard = economy.dbBalanceReadGuardReason();
    if (dbReadGuard != null && !dbReadGuard.isBlank()) {
      return "DB balance read unavailable: " + dbReadGuard;
    }
    return "";
  }

  public String statusSummary() {
    return "preloads=" + preloads.get()
        + " preloadFailures=" + preloadFailures.get()
        + " shadowMatches=" + shadowMatches.get()
        + " shadowMismatches=" + shadowMismatches.get()
        + " cached=" + cache.size();
  }

  static long toMinorUnits(double amount, int scale) {
    return BigDecimal.valueOf(amount)
        .multiply(BigDecimal.valueOf(Math.max(1, scale)))
        .setScale(0, RoundingMode.HALF_UP)
        .longValue();
  }

  private void warnOnce(String key, String message) {
    if (warnedKeys.add(key)) {
      logger.warning("[EconomyProvider] " + message);
    } else {
      logger.fine("[EconomyProvider] " + message);
    }
  }

  private static String rootMessage(Throwable error) {
    Throwable current = error;
    while (current.getCause() != null) {
      current = current.getCause();
    }
    String message = current.getMessage();
    return message == null || message.isBlank() ? current.getClass().getSimpleName() : message;
  }
}
