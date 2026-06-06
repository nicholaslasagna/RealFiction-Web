package com.realfiction.realcore.economy;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.config.EconomyReconcileConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.entity.Player;
import org.bukkit.plugin.RegisteredServiceProvider;

/**
 * Continuous, pull-only DB-to-Vault balance reconciliation.
 *
 * <p>The global economy DB ({@code economy_balances}) is the single source of truth and is what
 * the website leaderboard reads. Each backend pushes captured gameplay up to that ledger, but
 * nothing automatically writes the truth back down — so a server's local Vault/EssentialsX balance
 * only reflects money earned/spent on that server, and servers diverge. This service closes the
 * loop: on join (and on a periodic timer) it aligns the player's local Vault balance with the
 * authoritative DB balance.
 *
 * <p><b>Safety.</b> It is pull-only (deposit/withdraw into local Vault); it never writes the
 * ledger and so cannot double-pay. A persisted per-player baseline (the value we last set local
 * Vault to on this server) lets it tell apart "earned/spent on another server" (reconcile) from
 * "local balance rose since our last sync" (HOLD — never erase un-flushed captured income or
 * un-captured {@code /pay} / {@code /eco} income). It is disabled by default, allowlisted per
 * backend, capped, and dispatches all Vault work through {@link RealCoreScheduler} (Folia-safe).
 */
public final class EconomyReconciliationService {
  private static final String ECONOMY_CLASS = "net.milkbowl.vault.economy.Economy";

  private final RealCorePlugin plugin;
  private final RealCoreConfig config;
  private final EconomyService economy;
  private final RealCoreScheduler scheduler;
  private final Logger logger;

  private final ConcurrentHashMap<UUID, Long> baselines = new ConcurrentHashMap<>();
  private final Set<String> warnedKeys = ConcurrentHashMap.newKeySet();
  private final AtomicBoolean running = new AtomicBoolean(false);
  private volatile boolean baselinesDirty = false;
  private volatile ScheduledTaskHandle periodicTask;
  private volatile VaultBinding cachedBinding;

  private final AtomicLong deposits = new AtomicLong();
  private final AtomicLong withdrawals = new AtomicLong();
  private final AtomicLong holds = new AtomicLong();
  private final AtomicLong noops = new AtomicLong();
  private final AtomicLong caps = new AtomicLong();

  public EconomyReconciliationService(
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
      logger.info("Economy reconciliation disabled: " + guard);
      return;
    }
    loadBaselines();
    running.set(true);
    EconomyReconcileConfig rc = reconcileConfig();
    if (rc.periodicSeconds() > 0 && scheduler != null) {
      long period = rc.periodicSeconds();
      periodicTask = scheduler.runAsyncRepeating(this::reconcileOnlineTickSafely, period, period);
    }
    logger.info("Economy reconciliation enabled (onJoin=" + rc.onJoin()
        + ", periodicSeconds=" + rc.periodicSeconds()
        + ", maxPlayersPerRun=" + rc.maxPlayersPerRun()
        + ", maxDeltaMinor=" + rc.maxDeltaMinor()
        + ", dryRun=" + rc.dryRun() + ").");
  }

  public void stop() {
    running.set(false);
    ScheduledTaskHandle task = periodicTask;
    if (task != null) {
      try {
        task.cancel();
      } catch (Throwable ignored) {
        // best effort
      }
      periodicTask = null;
    }
    if (baselinesDirty) {
      saveBaselines();
    }
    cachedBinding = null;
  }

  public boolean enabled() {
    return running.get();
  }

  /**
   * Immediately deposit (credit=true) or withdraw the given minor amount from the player's local
   * Vault balance — for an instant /bal right after a gameplay capture, without waiting for the
   * capture -> DB -> reconcile roundtrip. It deliberately does NOT touch the baseline: the
   * reconciler's HOLD branch keeps this local-ahead-of-DB gap until the captured transaction reaches
   * the DB, then a NOOP settles it, so the roundtrip never double-applies the amount. No-op if Vault
   * is unavailable. (Do not combine with the live economy provider, which would route through the
   * same DB and double up.)
   */
  public void creditLocalImmediately(UUID uuid, long amountMinor, boolean credit) {
    if (uuid == null || amountMinor <= 0 || scheduler == null) {
      return;
    }
    scheduler.runGlobal(() -> {
      try {
        VaultBinding binding = binding();
        if (binding == null) {
          return;
        }
        OfflinePlayer player = Bukkit.getOfflinePlayer(uuid);
        createAccountIfSupported(binding, player);
        double amount = toVaultAmount(amountMinor, 100);
        Method mutation = credit ? binding.deposit() : binding.withdraw();
        invokeMoneyMutation(mutation, binding.provider(), player, amount);
      } catch (Throwable error) {
        warnOnce("immediate", "Immediate local credit failed: " + rootMessage(error));
      }
    });
  }

  /** Force-flush queued captures (e.g. on quit) so the DB is current before a server switch. */
  public void flushPendingCaptures() {
    if (economy == null) {
      return;
    }
    try {
      economy.requestFlush();
    } catch (Throwable ignored) {
      // best effort
    }
  }

  // -- triggers ---------------------------------------------------------------

  /** Schedules a delayed reconcile for a freshly joined player. Safe to call when disabled. */
  public void onPlayerJoin(Player player) {
    if (!running.get() || player == null) {
      return;
    }
    EconomyReconcileConfig rc = reconcileConfig();
    if (!rc.onJoin()) {
      return;
    }
    UUID uuid = player.getUniqueId();
    String name = player.getName();
    long delay = Math.max(0, rc.joinDelayTicks());
    if (scheduler == null) {
      reconcile(uuid, name, "join");
      return;
    }
    scheduler.runForPlayerLater(player, () -> reconcile(uuid, name, "join"), delay);
  }

  /** Reconciles all online players immediately (admin command). Returns the number scanned, or -1 when disabled. */
  public int triggerOnlineReconcile() {
    if (!running.get()) {
      return -1;
    }
    int cap = reconcileConfig().maxPlayersPerRun();
    int scanned = 0;
    for (Player player : Bukkit.getOnlinePlayers()) {
      if (scanned >= cap) {
        break;
      }
      scanned++;
      reconcile(player.getUniqueId(), player.getName(), "manual");
    }
    return scanned;
  }

  private void reconcileOnlineTickSafely() {
    try {
      if (!running.get() || scheduler == null) {
        return;
      }
      scheduler.runGlobal(() -> {
        int cap = reconcileConfig().maxPlayersPerRun();
        int scanned = 0;
        for (Player player : Bukkit.getOnlinePlayers()) {
          if (scanned >= cap) {
            break;
          }
          scanned++;
          reconcile(player.getUniqueId(), player.getName(), "periodic");
        }
      });
      saveBaselinesIfDirty();
    } catch (Throwable error) {
      warnOnce("tick", "Economy reconcile tick failed: " + rootMessage(error));
    }
  }

  private void reconcile(UUID uuid, String name, String trigger) {
    if (!running.get() || uuid == null) {
      return;
    }
    if (!guardReason().isBlank()) {
      return;
    }
    economy.fetchBalanceReadOnly(uuid).whenComplete((snapshot, error) -> {
      if (error != null) {
        warnOnce("dbread", "DB balance read failed during reconcile: " + rootMessage(error));
        return;
      }
      if (snapshot == null) {
        return;
      }
      if (scheduler == null) {
        applyOnRegion(uuid, name, snapshot, trigger);
      } else {
        scheduler.runGlobal(() -> applyOnRegion(uuid, name, snapshot, trigger));
      }
    });
  }

  // -- core (runs on the global/region thread for Vault safety) ----------------

  private void applyOnRegion(UUID uuid, String name, EconomyBalanceSnapshot snapshot, String trigger) {
    try {
      EconomyReconcileConfig rc = reconcileConfig();
      if (rc.requireOnline() && Bukkit.getPlayer(uuid) == null) {
        return;
      }
      VaultBinding binding = binding();
      if (binding == null) {
        warnOnce("vault", "Vault economy provider unavailable; cannot reconcile balances.");
        return;
      }
      OfflinePlayer player = Bukkit.getOfflinePlayer(uuid);
      createAccountIfSupported(binding, player);

      int scale = snapshot.scale();
      long localMinor = toMinorUnits(readBalance(binding, player), scale);
      long dbMinor = snapshot.balanceMinor();
      Long base = baselines.get(uuid);
      Decision decision = decide(base != null, base == null ? 0L : base, localMinor, dbMinor, rc.maxDeltaMinor());

      boolean dryRun = rc.dryRun();
      long afterMinor = localMinor;
      boolean applied = false;
      if (shouldMutateVault(decision, dryRun)) {
        double amount = toVaultAmount(Math.abs(decision.vaultDeltaMinor()), scale);
        Method mutation = decision.action() == Action.DEPOSIT ? binding.deposit() : binding.withdraw();
        invokeMoneyMutation(mutation, binding.provider(), player, amount);
        afterMinor = toMinorUnits(readBalance(binding, player), scale);
        applied = true;
      }

      if (shouldPersistBaseline(decision, dryRun)) {
        long newBaseline = applied ? afterMinor : decision.newBaselineMinor();
        Long previous = baselines.put(uuid, newBaseline);
        if (previous == null || previous != newBaseline) {
          baselinesDirty = true;
        }
      }

      recordOutcome(decision.action());
      logOutcome(trigger, name, uuid, dbMinor, localMinor, afterMinor, decision, dryRun, applied);
    } catch (Throwable error) {
      warnOnce("apply", "Economy reconcile failed for " + uuid + ": " + rootMessage(error));
    }
  }

  /**
   * Pure, branch-by-branch reconciliation decision.
   *
   * @param hasBaseline whether a baseline exists for this player on this server
   * @param baselineMinor the last value we set local Vault to on this server (ignored when {@code !hasBaseline})
   * @param localMinor the current local Vault balance in minor units
   * @param dbMinor the authoritative DB balance in minor units
   * @param maxDeltaMinor the maximum deposit/withdraw magnitude allowed in one reconcile
   */
  static Decision decide(boolean hasBaseline, long baselineMinor, long localMinor, long dbMinor, long maxDeltaMinor) {
    long cap = Math.max(1L, maxDeltaMinor);

    if (!hasBaseline) {
      if (dbMinor > localMinor) {
        long delta = dbMinor - localMinor;
        if (delta > cap) {
          return new Decision(Action.SKIP_CAP, 0, localMinor, true,
              "cold-start deposit " + delta + " exceeds maxDeltaMinor; baseline recorded, no change");
        }
        return new Decision(Action.DEPOSIT, delta, dbMinor, true, "cold-start: deposit to match DB");
      }
      if (dbMinor == localMinor) {
        return new Decision(Action.NOOP, 0, dbMinor, true, "cold-start: already matches DB");
      }
      // db < local on first sight: never withdraw before we have a baseline.
      return new Decision(Action.HOLD, 0, localMinor, true,
          "cold-start: local exceeds DB; holding (no withdraw on first sight)");
    }

    if (dbMinor == localMinor) {
      return new Decision(Action.NOOP, 0, dbMinor, true, "matches DB");
    }

    // Any un-reconciled local change since our last sync (an earn OR a spend) is being captured to
    // the DB and will appear there shortly. Hold so we don't fight it: re-depositing a local spend
    // would refund a purchase, and withdrawing a local earn would erase it. Once the capture reaches
    // the DB, db == local and the NOOP above advances the baseline.
    if (localMinor != baselineMinor) {
      return new Decision(Action.HOLD, 0, baselineMinor, false,
          "local changed since last sync; holding until the capture reaches the DB");
    }

    // local == baseline: no un-reconciled local activity, so a db-vs-local gap is a change from
    // another server (or while offline) — apply it.
    if (dbMinor > localMinor) {
      long delta = dbMinor - localMinor;
      if (delta > cap) {
        return new Decision(Action.SKIP_CAP, 0, baselineMinor, false, "deposit " + delta + " exceeds maxDeltaMinor");
      }
      return new Decision(Action.DEPOSIT, delta, dbMinor, true, "deposit to match DB (earned on another server)");
    }
    // db < local.
    if (dbMinor <= 0) {
      // A zero authoritative balance is never trustworthy enough to wipe local funds to zero:
      // a missing economy_balances row also reads as 0 (the RPC coalesces null -> 0). Hold instead
      // of withdrawing the player to nothing on a fresh/empty/unreachable economy.
      return new Decision(Action.HOLD, 0, baselineMinor, false,
          "DB balance is zero/absent; holding rather than wiping local to zero");
    }
    long delta = localMinor - dbMinor;
    if (delta > cap) {
      return new Decision(Action.SKIP_CAP, 0, baselineMinor, false, "withdraw " + delta + " exceeds maxDeltaMinor");
    }
    return new Decision(Action.WITHDRAW, delta, dbMinor, true, "withdraw to match DB (spent on another server)");
  }

  /** Vault is only mutated for a real DEPOSIT/WITHDRAW and never in dry-run mode. */
  static boolean shouldMutateVault(Decision decision, boolean dryRun) {
    return !dryRun && (decision.action() == Action.DEPOSIT || decision.action() == Action.WITHDRAW);
  }

  /** The persisted baseline is only advanced when the decision changed it and not in dry-run mode. */
  static boolean shouldPersistBaseline(Decision decision, boolean dryRun) {
    return !dryRun && decision.baselineChanged();
  }

  // -- Vault provider access (reflection; mirrors VaultBalanceSyncService) -----

  private VaultBinding binding() {
    VaultBinding existing = cachedBinding;
    if (existing != null) {
      return existing;
    }
    VaultBinding bound = bindEconomyProvider();
    cachedBinding = bound;
    return bound;
  }

  private VaultBinding bindEconomyProvider() {
    Class<?> economyClass;
    try {
      economyClass = Class.forName(ECONOMY_CLASS);
    } catch (ClassNotFoundException missing) {
      return null;
    }
    RegisteredServiceProvider<?> registration = Bukkit.getServicesManager().getRegistration(economyClass);
    if (registration == null || registration.getProvider() == null) {
      return null;
    }
    Object provider = registration.getProvider();
    try {
      Method getBalance = provider.getClass().getMethod("getBalance", OfflinePlayer.class);
      Method deposit = provider.getClass().getMethod("depositPlayer", OfflinePlayer.class, double.class);
      Method withdraw = provider.getClass().getMethod("withdrawPlayer", OfflinePlayer.class, double.class);
      Method createAccount = optionalMethod(provider, "createPlayerAccount", OfflinePlayer.class);
      return new VaultBinding(provider, getBalance, deposit, withdraw, createAccount);
    } catch (NoSuchMethodException error) {
      logger.log(Level.WARNING, "Vault Economy provider is missing required reconcile methods", error);
      return null;
    }
  }

  private Method optionalMethod(Object provider, String name, Class<?>... parameterTypes) {
    try {
      return provider.getClass().getMethod(name, parameterTypes);
    } catch (NoSuchMethodException ignored) {
      return null;
    }
  }

  private void createAccountIfSupported(VaultBinding binding, OfflinePlayer player) {
    if (binding.createAccount() == null) {
      return;
    }
    try {
      binding.createAccount().invoke(binding.provider(), player);
    } catch (Throwable error) {
      logger.log(Level.FINE, "Vault account creation skipped for " + player.getUniqueId(), error);
    }
  }

  private double readBalance(VaultBinding binding, OfflinePlayer player) throws Exception {
    Object result = binding.getBalance().invoke(binding.provider(), player);
    if (result instanceof Number number && Double.isFinite(number.doubleValue())) {
      return number.doubleValue();
    }
    throw new IllegalStateException("Vault provider returned a non-numeric balance.");
  }

  private void invokeMoneyMutation(Method method, Object provider, OfflinePlayer player, double amount) throws Exception {
    Object response = method.invoke(provider, player, amount);
    if (!transactionSuccess(response)) {
      throw new IllegalStateException("Vault mutation failed: " + errorMessage(response));
    }
  }

  private boolean transactionSuccess(Object response) {
    if (response == null) {
      return true;
    }
    try {
      Method transactionSuccess = response.getClass().getMethod("transactionSuccess");
      Object value = transactionSuccess.invoke(response);
      return value instanceof Boolean success && success;
    } catch (ReflectiveOperationException ignored) {
      return true;
    }
  }

  private String errorMessage(Object response) {
    if (response == null) {
      return "unknown error";
    }
    try {
      Object value = response.getClass().getField("errorMessage").get(response);
      return value == null ? "unknown error" : value.toString();
    } catch (ReflectiveOperationException ignored) {
      return "unknown error";
    }
  }

  static long toMinorUnits(double vaultBalance, int scale) {
    return BigDecimal.valueOf(vaultBalance)
        .multiply(BigDecimal.valueOf(Math.max(1, scale)))
        .setScale(0, RoundingMode.HALF_UP)
        .longValue();
  }

  static double toVaultAmount(long amountMinor, int scale) {
    return BigDecimal.valueOf(amountMinor)
        .divide(BigDecimal.valueOf(Math.max(1, scale)), 2, RoundingMode.HALF_UP)
        .doubleValue();
  }

  // -- guards, logging, persistence -------------------------------------------

  private EconomyReconcileConfig reconcileConfig() {
    return config.economy().reconcile();
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
    if (!reconcileConfig().enabled()) {
      return "economy.reconcile.enabled is false";
    }
    if ("anarchy".equalsIgnoreCase(config.serverGroup())) {
      return "anarchy may not reconcile the global economy";
    }
    if (!reconcileConfig().allows(config.serverId())) {
      return "server.id is not in economy.reconcile.backendAllowlist";
    }
    String dbReadGuard = economy.dbBalanceReadGuardReason();
    if (dbReadGuard != null && !dbReadGuard.isBlank()) {
      return "DB balance read unavailable: " + dbReadGuard;
    }
    return "";
  }

  public String statusSummary() {
    return "deposits=" + deposits.get()
        + " withdrawals=" + withdrawals.get()
        + " holds=" + holds.get()
        + " noops=" + noops.get()
        + " capSkips=" + caps.get()
        + " baselines=" + baselines.size();
  }

  private void recordOutcome(Action action) {
    switch (action) {
      case DEPOSIT -> deposits.incrementAndGet();
      case WITHDRAW -> withdrawals.incrementAndGet();
      case HOLD -> holds.incrementAndGet();
      case NOOP -> noops.incrementAndGet();
      case SKIP_CAP -> caps.incrementAndGet();
      default -> {
        // no counter
      }
    }
  }

  private void logOutcome(String trigger, String name, UUID uuid, long dbMinor, long localMinor,
                          long afterMinor, Decision decision, boolean dryRun, boolean applied) {
    String message = "[EconomyReconcile]"
        + " trigger=" + trigger
        + " name=" + name
        + " uuid=" + uuid
        + " dbMinor=" + dbMinor
        + " localMinor=" + localMinor
        + " afterMinor=" + afterMinor
        + " deltaMinor=" + decision.vaultDeltaMinor()
        + " action=" + decision.action().name().toLowerCase(Locale.ROOT)
        + " applied=" + applied
        + " dryRun=" + dryRun
        + (decision.reason().isBlank() ? "" : " reason=\"" + decision.reason().replace("\"", "'") + "\"");
    switch (decision.action()) {
      case DEPOSIT, WITHDRAW -> logger.info(message);
      case SKIP_CAP -> logger.warning(message);
      default -> logger.fine(message);
    }
  }

  private Path baselineFile() {
    return plugin.getDataFolder().toPath()
        .resolve("economy")
        .resolve("reconcile-baselines-" + safeFilePart(config.serverId()) + ".properties");
  }

  private void loadBaselines() {
    baselines.clear();
    Path file = baselineFile();
    if (Files.notExists(file)) {
      return;
    }
    try (var in = Files.newInputStream(file)) {
      Properties props = new Properties();
      props.load(in);
      for (String key : props.stringPropertyNames()) {
        try {
          baselines.put(UUID.fromString(key), Long.parseLong(props.getProperty(key).trim()));
        } catch (RuntimeException ignored) {
          // skip malformed line; cold-start logic will handle the player safely
        }
      }
      logger.info("Loaded " + baselines.size() + " economy reconcile baseline(s).");
    } catch (Exception error) {
      warnOnce("load", "Could not load reconcile baselines: " + rootMessage(error));
    }
  }

  private void saveBaselinesIfDirty() {
    if (baselinesDirty) {
      saveBaselines();
    }
  }

  private synchronized void saveBaselines() {
    try {
      Path file = baselineFile();
      Files.createDirectories(file.getParent());
      Properties props = new Properties();
      baselines.forEach((uuid, minor) -> props.setProperty(uuid.toString(), Long.toString(minor)));
      try (var out = Files.newOutputStream(file)) {
        props.store(out, "RealCore economy reconcile baselines (serverId=" + safeFilePart(config.serverId()) + ")");
      }
      baselinesDirty = false;
    } catch (Exception error) {
      warnOnce("save", "Could not save reconcile baselines: " + rootMessage(error));
    }
  }

  private void warnOnce(String key, String message) {
    if (warnedKeys.add(key)) {
      logger.warning("[EconomyReconcile] " + message);
    } else {
      logger.fine("[EconomyReconcile] " + message);
    }
  }

  private String safeFilePart(String value) {
    String safe = value == null ? "server" : value.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9_.-]", "-");
    return safe.isBlank() ? "server" : safe;
  }

  private static String rootMessage(Throwable error) {
    Throwable current = error;
    while (current.getCause() != null) {
      current = current.getCause();
    }
    String message = current.getMessage();
    return message == null || message.isBlank() ? current.getClass().getSimpleName() : message;
  }

  // -- value types ------------------------------------------------------------

  public enum Action {
    DEPOSIT,
    WITHDRAW,
    NOOP,
    HOLD,
    SKIP_CAP
  }

  /**
   * Outcome of {@link #decide}. {@code vaultDeltaMinor} is the magnitude to deposit/withdraw
   * (only meaningful for DEPOSIT/WITHDRAW). {@code newBaselineMinor} is the baseline to store
   * when {@code baselineChanged} is true (for DEPOSIT/WITHDRAW the caller overrides it with the
   * actual post-mutation balance).
   */
  public record Decision(
      Action action,
      long vaultDeltaMinor,
      long newBaselineMinor,
      boolean baselineChanged,
      String reason
  ) {}

  private record VaultBinding(
      Object provider,
      Method getBalance,
      Method deposit,
      Method withdraw,
      Method createAccount
  ) {}
}
