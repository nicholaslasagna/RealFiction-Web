package com.realfiction.realcore.economy;

import com.realfiction.realcore.RealCorePlugin;
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
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.logging.Level;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.plugin.RegisteredServiceProvider;

/**
 * Disabled-by-default, one-player DB-to-Vault sync helper.
 *
 * <p>This does not register a Vault provider and never runs automatically. It is
 * only used by the explicit admin staging command after {@code economy.enabled}
 * and {@code economy.syncVaultAfterDb} are both enabled on a non-Anarchy backend.
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
    String guard = guardReason();
    if (!guard.isBlank()) {
      return CompletableFuture.failedFuture(new IllegalStateException(guard));
    }
    String safeUsername = username == null || username.isBlank() ? "unknown" : username;
    return economy.fetchBalance(minecraftUuid)
        .thenCompose(snapshot -> runVaultMutation(snapshot, safeUsername, actor == null ? "unknown" : actor));
  }

  private String guardReason() {
    if (config == null || economy == null) {
      return "Global economy is not loaded.";
    }
    if (!economy.configuredEnabled()) {
      return "Global economy is disabled by economy.enabled=false.";
    }
    if (!config.modules().economy()) {
      return "Global economy is disabled by modules.economy=false.";
    }
    if (!economy.syncVaultAfterDb()) {
      return "Vault sync is disabled by economy.syncVaultAfterDb=false.";
    }
    if ("anarchy".equalsIgnoreCase(config.serverGroup())) {
      return "Anarchy may not sync the global economy into Vault.";
    }
    return "";
  }

  private CompletableFuture<SyncResult> runVaultMutation(EconomyBalanceSnapshot snapshot, String username, String actor) {
    CompletableFuture<SyncResult> future = new CompletableFuture<>();
    Runnable task = () -> {
      try {
        SyncResult result = applyVaultSync(snapshot, username, actor);
        future.complete(result);
      } catch (Throwable error) {
        future.completeExceptionally(error);
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

  private SyncResult applyVaultSync(EconomyBalanceSnapshot snapshot, String username, String actor) throws Exception {
    ProviderBinding binding = bindEconomyProvider();
    if (binding == null) {
      throw new IllegalStateException("Vault Economy provider is not available.");
    }

    OfflinePlayer player = Bukkit.getOfflinePlayer(snapshot.minecraftUuid());
    createAccountIfSupported(binding, player);

    double beforeVault = readBalance(binding, player);
    long beforeMinor = toMinorUnits(beforeVault, snapshot.scale());
    long targetMinor = snapshot.balanceMinor();
    long deltaMinor = targetMinor - beforeMinor;
    long absDelta = Math.abs(deltaMinor);
    if (absDelta > economy.syncVaultMaxDeltaMinor()) {
      throw new IllegalStateException("Vault sync delta " + absDelta
          + " exceeds economy.syncVaultMaxDeltaMinor=" + economy.syncVaultMaxDeltaMinor());
    }

    if (deltaMinor > 0) {
      invokeMoneyMutation(binding.deposit(), binding.provider(), player, toVaultAmount(deltaMinor, snapshot.scale()));
    } else if (deltaMinor < 0) {
      invokeMoneyMutation(binding.withdraw(), binding.provider(), player, toVaultAmount(-deltaMinor, snapshot.scale()));
    }

    double afterVault = readBalance(binding, player);
    long afterMinor = toMinorUnits(afterVault, snapshot.scale());
    SyncResult result = new SyncResult(
        config.serverId(),
        config.serverGroup(),
        binding.name(),
        snapshot.minecraftUuid(),
        username,
        snapshot.currencyKey(),
        snapshot.scale(),
        targetMinor,
        beforeMinor,
        afterMinor,
        deltaMinor,
        actor,
        Instant.now()
    );
    writeAudit(result);
    plugin.getLogger().info("Vault sync applied for " + username + " (" + snapshot.minecraftUuid()
        + "): targetMinor=" + targetMinor + ", beforeMinor=" + beforeMinor + ", afterMinor=" + afterMinor
        + ", deltaMinor=" + deltaMinor + ", actor=" + actor);
    return result;
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

  private void writeAudit(SyncResult result) {
    try {
      Path auditDir = plugin.getDataFolder().toPath().resolve("audits");
      Files.createDirectories(auditDir);
      Path file = auditDir.resolve("vault-sync-audit-" + safeFilePart(config.serverId()) + ".csv");
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
          Long.toString(result.deltaMinor())
      );
      StringBuilder body = new StringBuilder();
      if (newFile) {
        body.append("at,actor,serverId,serverGroup,provider,minecraftUuid,username,currencyKey,targetMinor,beforeMinor,afterMinor,deltaMinor\n");
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
      String actor,
      Instant at
  ) {
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
