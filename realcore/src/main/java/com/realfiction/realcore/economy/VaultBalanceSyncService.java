package com.realfiction.realcore.economy;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.config.EconomyConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.logging.Level;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.plugin.RegisteredServiceProvider;

/**
 * Disabled-by-default, manual DB-to-Vault alignment helper.
 *
 * <p>This is a staging/operations tool only. It never writes the DB economy
 * ledger, never registers a Vault provider, and never runs automatically.
 */
public final class VaultBalanceSyncService {
  private static final String ECONOMY_CLASS = "net.milkbowl.vault.economy.Economy";
  private static final DateTimeFormatter AUDIT_TIMESTAMP =
      DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneOffset.UTC);

  private final RealCorePlugin plugin;
  private final RealCoreConfig config;
  private final EconomyService economy;

  public VaultBalanceSyncService(RealCorePlugin plugin, RealCoreConfig config, EconomyService economy) {
    this.plugin = plugin;
    this.config = config;
    this.economy = economy;
  }

  public CompletableFuture<SyncResult> syncOne(UUID minecraftUuid, String username, String actor) {
    return syncTargets(List.of(new Target(minecraftUuid, username, true)), false, actor)
        .thenApply(report -> report.results().isEmpty()
            ? SyncResult.skipped(config.serverId(), config.serverGroup(), minecraftUuid, username, actor, "No result.")
            : report.results().get(0));
  }

  public CompletableFuture<SyncReport> syncTargets(List<Target> requested, boolean dryRun, String actor) {
    String guard = guardReason();
    if (!guard.isBlank()) {
      return CompletableFuture.failedFuture(new IllegalStateException(guard));
    }
    List<Target> safeRequested = requested == null ? List.of() : requested.stream()
        .filter(target -> target != null && target.minecraftUuid() != null)
        .toList();
    int maxPlayers = config.economy().syncVaultFromDbMaxPlayersPerRun();
    List<Target> targets = limitTargets(safeRequested, maxPlayers);
    int notScanned = Math.max(0, safeRequested.size() - targets.size());
    if (targets.isEmpty()) {
      return CompletableFuture.completedFuture(SyncReport.from(
          config.serverId(), config.serverGroup(), dryRun, List.of(), notScanned));
    }

    return bindEconomyProviderAsync().thenCompose(binding -> {
      if (binding == null) {
        return CompletableFuture.failedFuture(new IllegalStateException("Vault Economy provider is not available."));
      }
      List<CompletableFuture<SyncResult>> futures = targets.stream()
          .map(target -> syncTarget(binding, target, dryRun, actor == null ? "unknown" : actor))
          .toList();
      return CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new))
          .thenApply(ignored -> {
            List<SyncResult> results = futures.stream().map(CompletableFuture::join).toList();
            return SyncReport.from(config.serverId(), config.serverGroup(), dryRun, results, notScanned);
          });
    });
  }

  private String guardReason() {
    return guardReason(config, economy);
  }

  public static String guardReason(RealCoreConfig config, EconomyService economy) {
    return guardReason(
        config,
        economy != null && economy.configuredEnabled(),
        economy == null ? "Global economy is not loaded." : economy.dbBalanceReadGuardReason()
    );
  }

  static String guardReason(RealCoreConfig config, boolean economyEnabled, String dbReadGuardReason) {
    if (config == null) {
      return "Global economy config is not loaded.";
    }
    EconomyConfig economyConfig = config.economy();
    if (!config.modules().economy()) {
      return "Global economy is disabled by modules.economy=false.";
    }
    if (!economyEnabled) {
      return "Global economy is disabled by economy.enabled=false.";
    }
    if ("anarchy".equalsIgnoreCase(config.serverGroup())) {
      return "Anarchy may not sync the global economy into Vault.";
    }
    if (!economyConfig.syncVaultFromDbEnabled()) {
      return "Vault sync from DB is disabled by economy.syncVaultFromDbEnabled=false.";
    }
    String serverId = config.serverId() == null ? "" : config.serverId().toLowerCase(Locale.ROOT);
    if (!economyConfig.syncVaultFromDbBackendAllowlist().contains(serverId)) {
      return "server.id is not in economy.syncVaultFromDbBackendAllowlist.";
    }
    if (dbReadGuardReason != null && !dbReadGuardReason.isBlank()) {
      return "DB balance read is unavailable: " + dbReadGuardReason;
    }
    return "";
  }

  static List<Target> limitTargets(List<Target> targets, int maxPlayers) {
    if (targets == null || targets.isEmpty()) {
      return List.of();
    }
    int limit = Math.max(1, maxPlayers);
    return targets.stream().limit(limit).toList();
  }

  private CompletableFuture<SyncResult> syncTarget(ProviderBinding binding, Target target, boolean dryRun, String actor) {
    if (config.economy().syncVaultFromDbRequireOnline() && !target.online()) {
      SyncResult result = SyncResult.skipped(
          config.serverId(), config.serverGroup(), target.minecraftUuid(), target.username(), actor,
          "Player is not online and economy.syncVaultFromDbRequireOnline=true.");
      logResult(result);
      return CompletableFuture.completedFuture(result);
    }
    return economy.fetchBalanceReadOnly(target.minecraftUuid())
        .handle((snapshot, error) -> {
          if (error != null) {
            SyncResult result = SyncResult.failed(
                config.serverId(), config.serverGroup(), target.minecraftUuid(), target.username(), actor,
                "DB balance read failed: " + rootMessage(error));
            logResult(result);
            return CompletableFuture.completedFuture(result);
          }
          return runVaultAlignment(binding, target, snapshot, dryRun, actor);
        })
        .thenCompose(future -> future);
  }

  private CompletableFuture<ProviderBinding> bindEconomyProviderAsync() {
    CompletableFuture<ProviderBinding> future = new CompletableFuture<>();
    Runnable task = () -> future.complete(bindEconomyProvider());
    RealCoreScheduler scheduler = plugin.scheduler();
    if (scheduler == null) {
      task.run();
    } else {
      scheduler.runGlobal(task);
    }
    return future;
  }

  private CompletableFuture<SyncResult> runVaultAlignment(
      ProviderBinding binding,
      Target target,
      EconomyBalanceSnapshot snapshot,
      boolean dryRun,
      String actor
  ) {
    CompletableFuture<SyncResult> future = new CompletableFuture<>();
    Runnable task = () -> {
      try {
        SyncResult result = applyVaultAlignment(binding, target, snapshot, dryRun, actor);
        future.complete(result);
      } catch (Throwable error) {
        SyncResult result = SyncResult.failed(
            config.serverId(), config.serverGroup(), target.minecraftUuid(), target.username(), actor,
            rootMessage(error));
        logResult(result);
        future.complete(result);
      }
    };
    RealCoreScheduler scheduler = plugin.scheduler();
    if (scheduler == null) {
      task.run();
    } else {
      scheduler.runGlobal(task);
    }
    return future;
  }

  private SyncResult applyVaultAlignment(
      ProviderBinding binding,
      Target target,
      EconomyBalanceSnapshot snapshot,
      boolean dryRun,
      String actor
  ) throws Exception {
    OfflinePlayer player = Bukkit.getOfflinePlayer(snapshot.minecraftUuid());
    createAccountIfSupported(binding, player);

    double beforeVault = readBalance(binding, player);
    long beforeMinor = toMinorUnits(beforeVault, snapshot.scale());
    long targetMinor = snapshot.balanceMinor();
    SyncDecision decision = decide(targetMinor, beforeMinor, config.economy().syncVaultFromDbMaxDeltaMinor());
    long afterMinor = beforeMinor;
    boolean applied = false;

    if (!decision.skipped() && !dryRun) {
      if (decision.action() == SyncAction.DEPOSIT) {
        invokeMoneyMutation(binding.deposit(), binding.provider(), player, toVaultAmount(decision.absDeltaMinor(), snapshot.scale()));
        applied = true;
      } else if (decision.action() == SyncAction.WITHDRAW) {
        invokeMoneyMutation(binding.withdraw(), binding.provider(), player, toVaultAmount(decision.absDeltaMinor(), snapshot.scale()));
        applied = true;
      }
      afterMinor = toMinorUnits(readBalance(binding, player), snapshot.scale());
    }

    SyncResult result = new SyncResult(
        config.serverId(),
        config.serverGroup(),
        binding.name(),
        snapshot.minecraftUuid(),
        target.username(),
        snapshot.currencyKey(),
        snapshot.scale(),
        targetMinor,
        beforeMinor,
        afterMinor,
        decision.deltaMinor(),
        decision.action(),
        decision.reason(),
        dryRun,
        applied,
        decision.skipped(),
        false,
        actor,
        Instant.now()
    );
    logResult(result);
    return result;
  }

  static SyncDecision decide(long targetMinor, long beforeMinor, long maxDeltaMinor) {
    long deltaMinor = targetMinor - beforeMinor;
    long absDelta = Math.abs(deltaMinor);
    if (absDelta > Math.max(1, maxDeltaMinor)) {
      return new SyncDecision(SyncAction.SKIP, deltaMinor, absDelta, true,
          "delta exceeds economy.syncVaultFromDbMaxDeltaMinor");
    }
    if (deltaMinor > 0) {
      return new SyncDecision(SyncAction.DEPOSIT, deltaMinor, absDelta, false, "");
    }
    if (deltaMinor < 0) {
      return new SyncDecision(SyncAction.WITHDRAW, deltaMinor, absDelta, false, "");
    }
    return new SyncDecision(SyncAction.NOOP, deltaMinor, 0, false, "");
  }

  private ProviderBinding bindEconomyProvider() {
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
      return new ProviderBinding(provider, providerName(provider), getBalance, deposit, withdraw, createAccount);
    } catch (NoSuchMethodException error) {
      plugin.getLogger().log(Level.WARNING, "Vault Economy provider is missing required sync methods", error);
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

  private String providerName(Object provider) {
    try {
      Method getName = provider.getClass().getMethod("getName");
      Object name = getName.invoke(provider);
      if (name instanceof String string && !string.isBlank()) {
        return string;
      }
    } catch (Throwable ignored) {
      // Provider class name is enough for local audit logs.
    }
    return provider.getClass().getName();
  }

  private void createAccountIfSupported(ProviderBinding binding, OfflinePlayer player) {
    if (binding.createAccount() == null) {
      return;
    }
    try {
      binding.createAccount().invoke(binding.provider(), player);
    } catch (Throwable error) {
      plugin.getLogger().log(Level.FINE, "Vault account creation skipped for " + player.getUniqueId(), error);
    }
  }

  private double readBalance(ProviderBinding binding, OfflinePlayer player) throws Exception {
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

  private void logResult(SyncResult result) {
    writeAudit(result);
    plugin.getLogger().info("Vault sync from DB "
        + "timestamp=" + result.at()
        + " backend=" + result.serverId()
        + " group=" + result.serverGroup()
        + " uuid=" + result.minecraftUuid()
        + " username=" + result.username()
        + " dbBalanceMinor=" + result.targetMinor()
        + " vaultBalanceMinor=" + result.beforeMinor()
        + " afterVaultMinor=" + result.afterMinor()
        + " deltaMinor=" + result.deltaMinor()
        + " action=" + result.action().name().toLowerCase(Locale.ROOT)
        + " dryRun=" + result.dryRun()
        + " applied=" + result.applied()
        + " skipped=" + result.skipped()
        + " failed=" + result.failed()
        + (result.reason().isBlank() ? "" : " reason=\"" + result.reason().replace("\"", "'") + "\""));
  }

  private void writeAudit(SyncResult result) {
    try {
      Path auditDir = plugin.getDataFolder().toPath().resolve("audits");
      Files.createDirectories(auditDir);
      Path file = auditDir.resolve("vault-sync-from-db-audit-" + safeFilePart(config.serverId()) + ".csv");
      boolean newFile = Files.notExists(file);
      String line = String.join(",",
          csv(result.at().toString()),
          csv(result.actor()),
          csv(result.serverId()),
          csv(result.serverGroup()),
          csv(result.providerName()),
          csv(result.minecraftUuid().toString()),
          csv(result.username()),
          csv(result.currencyKey()),
          Long.toString(result.targetMinor()),
          Long.toString(result.beforeMinor()),
          Long.toString(result.afterMinor()),
          Long.toString(result.deltaMinor()),
          csv(result.action().name().toLowerCase(Locale.ROOT)),
          Boolean.toString(result.dryRun()),
          Boolean.toString(result.applied()),
          Boolean.toString(result.skipped()),
          Boolean.toString(result.failed()),
          csv(result.reason())
      );
      StringBuilder body = new StringBuilder();
      if (newFile) {
        body.append("at,actor,serverId,serverGroup,provider,minecraftUuid,username,currencyKey,targetMinor,beforeMinor,afterMinor,deltaMinor,action,dryRun,applied,skipped,failed,reason\n");
      }
      body.append(line).append('\n');
      Files.writeString(file, body.toString(), StandardCharsets.UTF_8,
          newFile ? java.nio.file.StandardOpenOption.CREATE_NEW : java.nio.file.StandardOpenOption.APPEND);
    } catch (Exception error) {
      plugin.getLogger().log(Level.WARNING, "Could not write Vault sync audit log", error);
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

  static String syncFileTimestamp(Instant instant) {
    return AUDIT_TIMESTAMP.format(instant);
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

  private static String csv(String value) {
    String safe = value == null ? "" : value;
    boolean quote = safe.contains(",") || safe.contains("\"") || safe.contains("\n") || safe.contains("\r");
    String escaped = safe.replace("\"", "\"\"");
    return quote ? "\"" + escaped + "\"" : escaped;
  }

  private record ProviderBinding(
      Object provider,
      String name,
      Method getBalance,
      Method deposit,
      Method withdraw,
      Method createAccount
  ) {}

  public record Target(UUID minecraftUuid, String username, boolean online) {}

  public enum SyncAction {
    DEPOSIT,
    WITHDRAW,
    NOOP,
    SKIP
  }

  public record SyncDecision(
      SyncAction action,
      long deltaMinor,
      long absDeltaMinor,
      boolean skipped,
      String reason
  ) {}

  public record SyncReport(
      String serverId,
      String serverGroup,
      boolean dryRun,
      List<SyncResult> results,
      int notScannedDueToLimit
  ) {
    static SyncReport from(String serverId, String serverGroup, boolean dryRun, List<SyncResult> results,
                           int notScannedDueToLimit) {
      return new SyncReport(serverId, serverGroup, dryRun, List.copyOf(results), notScannedDueToLimit);
    }

    public int scanned() {
      return results.size();
    }

    public int wouldUpdate() {
      return (int) results.stream()
          .filter(result -> !result.skipped() && !result.failed() && result.action() != SyncAction.NOOP)
          .count();
    }

    public int applied() {
      return (int) results.stream().filter(SyncResult::applied).count();
    }

    public int skipped() {
      return notScannedDueToLimit + (int) results.stream().filter(SyncResult::skipped).count();
    }

    public int failed() {
      return (int) results.stream().filter(SyncResult::failed).count();
    }

    public long largestDeltaMinor() {
      return results.stream()
          .mapToLong(result -> Math.abs(result.deltaMinor()))
          .max()
          .orElse(0);
    }

    public long totalPositiveDeltaMinor() {
      return results.stream()
          .mapToLong(result -> Math.max(0, result.deltaMinor()))
          .sum();
    }

    public long totalNegativeDeltaMinor() {
      return results.stream()
          .mapToLong(result -> Math.min(0, result.deltaMinor()))
          .sum();
    }
  }

  public record SyncResult(
      String serverId,
      String serverGroup,
      String providerName,
      UUID minecraftUuid,
      String username,
      String currencyKey,
      int scale,
      long targetMinor,
      long beforeMinor,
      long afterMinor,
      long deltaMinor,
      SyncAction action,
      String reason,
      boolean dryRun,
      boolean applied,
      boolean skipped,
      boolean failed,
      String actor,
      Instant at
  ) {
    static SyncResult skipped(String serverId, String serverGroup, UUID minecraftUuid, String username, String actor,
                              String reason) {
      return new SyncResult(serverId, serverGroup, "", minecraftUuid, username, "", 100, 0, 0, 0, 0,
          SyncAction.SKIP, reason, true, false, true, false, actor, Instant.now());
    }

    static SyncResult failed(String serverId, String serverGroup, UUID minecraftUuid, String username, String actor,
                             String reason) {
      return new SyncResult(serverId, serverGroup, "", minecraftUuid, username, "", 100, 0, 0, 0, 0,
          SyncAction.SKIP, reason, true, false, false, true, actor, Instant.now());
    }

    public String targetDollars() {
      return EconomyBalanceFormat.formatMinor(targetMinor, scale);
    }

    public String beforeDollars() {
      return EconomyBalanceFormat.formatMinor(beforeMinor, scale);
    }

    public String afterDollars() {
      return EconomyBalanceFormat.formatMinor(afterMinor, scale);
    }
  }
}
