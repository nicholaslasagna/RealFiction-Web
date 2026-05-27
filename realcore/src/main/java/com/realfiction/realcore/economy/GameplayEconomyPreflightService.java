package com.realfiction.realcore.economy;

import com.realfiction.realcore.config.EconomyConfig;
import com.realfiction.realcore.config.GameplayEconomyObservabilityConfig;
import com.realfiction.realcore.config.GameplayEconomyProducerConfig;
import com.realfiction.realcore.config.GameplayEconomySyncConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;

/**
 * Read-only gameplay economy live-write readiness checks. Does not submit transactions,
 * mutate Vault, or change database policy.
 */
public final class GameplayEconomyPreflightService {
  public static final UUID API_PROBE_UUID = UUID.fromString("00000000-0000-0000-0000-000000000001");

  public static final long SMP_TRIAL_MAX_CREDIT_MINOR = 50_000L;
  public static final long SMP_TRIAL_MAX_DEBIT_MINOR = 50_000L;
  public static final int SMP_TRIAL_MAX_BATCH_SIZE = 50;
  public static final int SMP_TRIAL_BUFFER_SIZE = 5_000;

  private static final double QUEUE_NEAR_RATIO = 0.9;
  private static final long RECENT_FAILURE_WINDOW_MS = 15 * 60 * 1000L;
  private static final long DUPLICATE_STORM_THRESHOLD = 50L;
  private static final double DRY_RUN_SAFE_TX_PER_MIN = 120.0;
  private static final double DRY_RUN_SAFE_REQ_PER_MIN = 15.0;

  public enum Mode {
    DRYRUN,
    LIVE
  }

  public enum Status {
    PASS,
    WARN,
    FAIL
  }

  public record Check(String id, Status status, String detail) {}

  public record Report(Mode mode, List<Check> checks) {
    public boolean ready() {
      return checks.stream().noneMatch(check -> check.status() == Status.FAIL);
    }

    public String summaryLabel() {
      return ready() ? "READY" : "NOT READY";
    }

    public List<String> formatLines() {
      List<String> lines = new ArrayList<>();
      lines.add("RealCore Gameplay Economy Preflight: " + (mode == Mode.DRYRUN ? "DRY-RUN" : "LIVE"));
      for (Check check : checks) {
        lines.add(check.status().name() + " " + check.id + detailSuffix(check.detail()));
      }
      lines.add("Summary: " + summaryLabel());
      return lines;
    }

    private static String detailSuffix(String detail) {
      if (detail == null || detail.isBlank()) {
        return "";
      }
      return "=" + detail;
    }
  }

  /**
   * Optional plugin/runtime probes. Tests supply a stub implementation.
   */
  public interface RuntimeProbe {
    boolean vaultInstalled();

    boolean vaultEconomyProviderRegistered();

    boolean economyShopGuiPresent();

    boolean placeholderApiPresent();

    boolean luckPermsPresent();
  }

  public static final class Snapshot {
    private final RealCoreConfig config;
    private final EconomyService economyService;
    private final GameplayEconomyTransactionBuffer buffer;
    private final RuntimeProbe runtime;

    public Snapshot(
        RealCoreConfig config,
        EconomyService economyService,
        GameplayEconomyTransactionBuffer buffer,
        RuntimeProbe runtime
    ) {
      this.config = Objects.requireNonNull(config, "config");
      this.economyService = economyService;
      this.buffer = buffer;
      this.runtime = runtime == null ? unavailableRuntimeProbe() : runtime;
    }
  }

  public Report run(Mode mode, Snapshot snapshot) {
    Objects.requireNonNull(mode, "mode");
    Objects.requireNonNull(snapshot, "snapshot");
    List<Check> checks = new ArrayList<>();
    RealCoreConfig config = snapshot.config;
    EconomyConfig economy = config.economy();
    GameplayEconomySyncConfig gameplay = economy.gameplaySync();
    GameplayEconomyObservabilityConfig observability = gameplay.observability();
    BufferedEconomyTransactionWriter writer = snapshot.economyService == null ? null : snapshot.economyService.writer();
    GameplayEconomyTransactionBuffer buffer = snapshot.buffer;
    GameplayEconomyWriterMetrics metrics = buffer == null ? null : buffer.gameplayMetrics();

    addBackendIdentityChecks(checks, config, gameplay);
    addModuleConfigChecks(checks, config, economy, gameplay, observability, mode);
    addDependencyChecks(checks, config, gameplay, snapshot.runtime);
    addWriterStateChecks(checks, mode, gameplay, buffer, writer, metrics);
    addModeSpecificChecks(checks, mode, gameplay, buffer, metrics);

    if (mode == Mode.LIVE) {
      addLiveTrialCapChecks(checks, gameplay);
    }

    return new Report(mode, List.copyOf(checks));
  }

  public Report withApiChecks(Report base, ApiProbeResult apiResult) {
    List<Check> checks = new ArrayList<>(base.checks());
    addApiChecks(checks, base.mode(), apiResult);
    return new Report(base.mode(), List.copyOf(checks));
  }

  public record ApiProbeResult(
      boolean attempted,
      boolean reachable,
      boolean hmacAccepted,
      boolean balanceReadOk,
      String failureMessage
  ) {
    public static ApiProbeResult skipped(String reason) {
      return new ApiProbeResult(false, false, false, false, reason);
    }

    public static ApiProbeResult success() {
      return new ApiProbeResult(true, true, true, true, "");
    }

    public static ApiProbeResult reachableButNotBalance(String message) {
      return new ApiProbeResult(true, true, true, false, message);
    }

    public static ApiProbeResult failed(String message) {
      return new ApiProbeResult(true, false, false, false, message);
    }
  }

  private static void addBackendIdentityChecks(
      List<Check> checks,
      RealCoreConfig config,
      GameplayEconomySyncConfig gameplay
  ) {
    String serverId = config.serverId() == null ? "" : config.serverId().trim();
    String serverGroup = config.serverGroup() == null ? "" : config.serverGroup().trim();
    String normalizedId = serverId.toLowerCase(Locale.ROOT);

    if (serverId.isBlank()) {
      checks.add(new Check("serverId", Status.FAIL, "missing"));
    } else {
      checks.add(new Check("backend", Status.PASS, serverId));
    }

    if (serverGroup.isBlank()) {
      checks.add(new Check("serverGroup", Status.FAIL, "missing"));
    } else {
      checks.add(new Check("serverGroup", Status.PASS, serverGroup));
    }

    if (serverId.isBlank()) {
      checks.add(new Check("backendAllowlist", Status.FAIL, "server.id missing"));
    } else if (gameplay.backendAllowlist().contains(normalizedId)) {
      checks.add(new Check("backendAllowlist", Status.PASS, normalizedId));
    } else {
      checks.add(new Check("backendAllowlist", Status.FAIL, "not listed"));
    }

    if ("anarchy".equalsIgnoreCase(serverGroup)) {
      checks.add(new Check("anarchyBlocked", Status.FAIL, "server.group=anarchy"));
    } else {
      checks.add(new Check("anarchyBlocked", Status.PASS, "ok"));
    }

    if ("anarchy-1".equalsIgnoreCase(normalizedId)) {
      checks.add(new Check("anarchyServerId", Status.FAIL, "anarchy-1"));
    } else {
      checks.add(new Check("anarchyServerId", Status.PASS, "ok"));
    }
  }

  private static void addModuleConfigChecks(
      List<Check> checks,
      RealCoreConfig config,
      EconomyConfig economy,
      GameplayEconomySyncConfig gameplay,
      GameplayEconomyObservabilityConfig observability,
      Mode mode
  ) {
    checks.add(boolCheck("modulesEconomy", config.modules().economy(), "true"));
    checks.add(boolCheck("economyEnabled", economy.enabled(), "true"));

    if (mode == Mode.LIVE) {
      checks.add(boolCheck("gameplaySyncEnabled", gameplay.enabled(), "true"));
    } else {
      checks.add(new Check(
          "gameplaySyncEnabled",
          gameplay.enabled() ? Status.PASS : Status.WARN,
          Boolean.toString(gameplay.enabled())
      ));
    }

    if (mode == Mode.DRYRUN) {
      checks.add(new Check(
          "dryRun",
          gameplay.dryRun() ? Status.PASS : Status.FAIL,
          Boolean.toString(gameplay.dryRun())
      ));
    } else {
      checks.add(new Check(
          "dryRun",
          gameplay.dryRun() ? Status.FAIL : Status.PASS,
          Boolean.toString(gameplay.dryRun())
      ));
    }

    GameplayEconomyProducerConfig producer = gameplay.producers().economyShopGuiSell();
    if (mode == Mode.LIVE && !producer.enabled()) {
      checks.add(new Check("producerDisabled", Status.FAIL, "true"));
    } else if (producer.enabled()) {
      checks.add(new Check("producerDisabled", Status.PASS, "false"));
    } else {
      checks.add(new Check("producerDisabled", Status.WARN, "true"));
    }

    if (mode == Mode.LIVE) {
      checks.add(boolCheck("shopSell", gameplay.shopSell(), "true"));
    } else {
      checks.add(new Check(
          "shopSell",
          gameplay.shopSell() ? Status.PASS : Status.WARN,
          Boolean.toString(gameplay.shopSell())
      ));
    }
    checks.add(boolCheck(
        "gameplaySpendDisabled",
        !gameplay.gameplaySpend(),
        mode == Mode.LIVE ? "true" : "required-off"
    ));
    checks.add(boolCheck(
        "shopBuyDisabled",
        !gameplay.shopBuy(),
        mode == Mode.LIVE ? "true" : "required-off"
    ));

    checks.add(capCheck("maxCreditMinorPerTx", gameplay.maxCreditMinorPerTx(), 1, 1_000_000_000_000L));
    checks.add(capCheck("maxDebitMinorPerTx", gameplay.maxDebitMinorPerTx(), 1, 1_000_000_000_000L));
    checks.add(capCheck("maxBatchSize", gameplay.maxBatchSize(), 1, 500));
    checks.add(capCheck("bufferSize", gameplay.bufferSize(), gameplay.maxBatchSize(), 50_000));
    checks.add(capCheck("maxQueueEntries", observability.maxQueueEntries(), 10, 50_000));
    checks.add(capCheck("maxRetryEntries", observability.maxRetryEntries(), 1, 100));
    long maxAgeSeconds = observability.maxTransactionAge().toSeconds();
    checks.add(capCheck("maxTransactionAgeSeconds", maxAgeSeconds, 60, 86_400));
  }

  private static void addDependencyChecks(
      List<Check> checks,
      RealCoreConfig config,
      GameplayEconomySyncConfig gameplay,
      RuntimeProbe runtime
  ) {
    checks.add(boolCheck("vaultPresent", runtime.vaultInstalled(), "true"));
    checks.add(boolCheck("vaultEconomyProvider", runtime.vaultEconomyProviderRegistered(), "true"));

    if (gameplay.producers().economyShopGuiSell().enabled()) {
      checks.add(boolCheck("economyShopGuiPresent", runtime.economyShopGuiPresent(), "true"));
    } else {
      checks.add(new Check("economyShopGuiPresent", Status.PASS, "producer-disabled"));
    }

    checks.add(new Check(
        "placeholderApi",
        runtime.placeholderApiPresent() ? Status.PASS : Status.PASS,
        runtime.placeholderApiPresent() ? "present" : "optional-missing"
    ));
    checks.add(new Check(
        "luckPerms",
        runtime.luckPermsPresent() ? Status.PASS : Status.PASS,
        runtime.luckPermsPresent() ? "present" : "optional-missing"
    ));

    URI baseUrl = config.baseUrl();
    if (baseUrl == null || baseUrl.toString().isBlank()) {
      checks.add(new Check("baseUrl", Status.FAIL, "missing"));
    } else {
      checks.add(new Check("baseUrl", Status.PASS, baseUrl.getHost()));
    }

    if (config.hmacSecretConfigured()) {
      checks.add(new Check("hmacSecret", Status.PASS, "configured"));
    } else {
      checks.add(new Check("hmacSecret", Status.FAIL, "missing"));
    }

    if (config.hmacSecretConfigured() && baseUrl != null && !baseUrl.toString().isBlank()) {
      checks.add(new Check("websiteClientReady", Status.PASS, "baseUrl+hmac"));
    } else {
      checks.add(new Check("websiteClientReady", Status.FAIL, "incomplete"));
    }
  }

  private static void addWriterStateChecks(
      List<Check> checks,
      Mode mode,
      GameplayEconomySyncConfig gameplay,
      GameplayEconomyTransactionBuffer buffer,
      BufferedEconomyTransactionWriter writer,
      GameplayEconomyWriterMetrics metrics
  ) {
    if (buffer == null) {
      checks.add(new Check("gameplayBuffer", Status.WARN, "not-loaded"));
    }

    if (writer == null) {
      checks.add(new Check("writer", Status.FAIL, "missing"));
      return;
    }
    checks.add(new Check("writer", Status.PASS, writer.running() ? "running" : "stopped"));

    int queueDepth = buffer == null ? 0 : buffer.gameplayQueueDepth();
    int maxQueue = gameplay.observability().maxQueueEntries();
    addQueuePressureCheck(checks, "gameplayQueue", queueDepth, maxQueue);

    int retryDepth = buffer == null ? 0 : buffer.writerRetryDepth();
    int maxRetry = gameplay.observability().maxRetryEntries();
    addQueuePressureCheck(checks, "retryQueue", retryDepth, maxRetry);

    long failureAt = writer.lastFailureAtMillis();
    if (failureAt > 0 && System.currentTimeMillis() - failureAt < RECENT_FAILURE_WINDOW_MS) {
      checks.add(new Check("recentWriterFailure", Status.FAIL, writer.lastFailureReason()));
    } else {
      checks.add(new Check("recentWriterFailure", Status.PASS, "none"));
    }

    int httpStatus = writer.lastHttpStatus();
    if (gameplay.dryRun()) {
      if (httpStatus == 0 || httpStatus == 200) {
        checks.add(new Check("lastHttpStatus", Status.PASS, httpStatus == 0 ? "none" : Integer.toString(httpStatus)));
      } else {
        checks.add(new Check("lastHttpStatus", Status.WARN, Integer.toString(httpStatus)));
      }
    } else if (mode == Mode.LIVE && httpStatus != 0 && httpStatus != 200) {
      checks.add(new Check("lastHttpStatus", Status.FAIL, Integer.toString(httpStatus)));
    } else {
      checks.add(new Check("lastHttpStatus", Status.PASS, httpStatus == 0 ? "none" : Integer.toString(httpStatus)));
    }

    long permanentRejects = metrics == null ? writer.permanentRejectTransactions() : metrics.gameplayPermanentRejects();
    if (permanentRejects > 0) {
      checks.add(new Check("permanentRejects", Status.FAIL, Long.toString(permanentRejects)));
    } else {
      checks.add(new Check("permanentRejects", Status.PASS, "0"));
    }

    long duplicates = metrics == null ? writer.duplicateTransactions() : metrics.gameplayDuplicates();
    if (duplicates >= DUPLICATE_STORM_THRESHOLD) {
      checks.add(new Check("duplicateStorm", Status.FAIL, Long.toString(duplicates)));
    } else if (duplicates > 0) {
      checks.add(new Check("duplicateStorm", Status.WARN, Long.toString(duplicates)));
    } else {
      checks.add(new Check("duplicateStorm", Status.PASS, "0"));
    }

    int overflowDrops = writer.queueOverflowDrops();
    if (overflowDrops > 0) {
      checks.add(new Check("overflowDrops", Status.FAIL, Integer.toString(overflowDrops)));
    } else {
      checks.add(new Check("overflowDrops", Status.PASS, "0"));
    }

    long expiredDrops = metrics == null ? 0 : metrics.gameplayDropped();
    if (expiredDrops > 0) {
      checks.add(new Check("expiredDrops", Status.FAIL, Long.toString(expiredDrops)));
    } else {
      checks.add(new Check("expiredDrops", Status.PASS, "0"));
    }
  }

  private static void addModeSpecificChecks(
      List<Check> checks,
      Mode mode,
      GameplayEconomySyncConfig gameplay,
      GameplayEconomyTransactionBuffer buffer,
      GameplayEconomyWriterMetrics metrics
  ) {
    if (mode == Mode.DRYRUN) {
      if (!gameplay.dryRun()) {
        checks.add(new Check("dryRunRequired", Status.FAIL, "dryRun=false"));
      } else {
        checks.add(new Check("dryRunRequired", Status.PASS, "true"));
      }
      long accepted = buffer == null ? 0 : buffer.acceptedCount();
      if (accepted > 0) {
        checks.add(new Check("noWriterEnqueue", Status.FAIL, "accepted=" + accepted));
      } else {
        checks.add(new Check("noWriterEnqueue", Status.PASS, "ok"));
      }
      addDryRunEstimateChecks(checks, buffer, metrics, gameplay);
      return;
    }

    if (gameplay.dryRun()) {
      checks.add(new Check("liveDryRunOff", Status.FAIL, "dryRun=true"));
    } else {
      checks.add(new Check("liveDryRunOff", Status.PASS, "dryRun=false"));
    }
    if (!gameplay.enabled()) {
      checks.add(new Check("liveGameplaySync", Status.FAIL, "enabled=false"));
    } else {
      checks.add(new Check("liveGameplaySync", Status.PASS, "enabled=true"));
    }
  }

  private static void addDryRunEstimateChecks(
      List<Check> checks,
      GameplayEconomyTransactionBuffer buffer,
      GameplayEconomyWriterMetrics metrics,
      GameplayEconomySyncConfig gameplay
  ) {
    if (metrics == null || buffer == null) {
      checks.add(new Check("dryRunEstimates", Status.WARN, "metrics-unavailable"));
      return;
    }
    double txPerMin = metrics.dryRunEstimatedTransactionsPerMinute();
    int flushSeconds = (int) gameplay.flushInterval().toSeconds();
    double reqPerMin = metrics.dryRunEstimatedRequestsPerMinute(flushSeconds);
    if (txPerMin > DRY_RUN_SAFE_TX_PER_MIN || reqPerMin > DRY_RUN_SAFE_REQ_PER_MIN) {
      checks.add(new Check(
          "dryRunEstimates",
          Status.WARN,
          String.format(Locale.US, "tx/min=%.2f req/min=%.2f", txPerMin, reqPerMin)
      ));
    } else {
      checks.add(new Check(
          "dryRunEstimates",
          Status.PASS,
          String.format(Locale.US, "tx/min=%.2f req/min=%.2f", txPerMin, reqPerMin)
      ));
    }
  }

  private static void addLiveTrialCapChecks(List<Check> checks, GameplayEconomySyncConfig gameplay) {
    if (gameplay.maxCreditMinorPerTx() != SMP_TRIAL_MAX_CREDIT_MINOR) {
      checks.add(new Check(
          "smpTrialMaxCredit",
          Status.FAIL,
          Long.toString(gameplay.maxCreditMinorPerTx())
      ));
    } else {
      checks.add(new Check("smpTrialMaxCredit", Status.PASS, Long.toString(SMP_TRIAL_MAX_CREDIT_MINOR)));
    }
    if (gameplay.maxDebitMinorPerTx() != SMP_TRIAL_MAX_DEBIT_MINOR) {
      checks.add(new Check(
          "smpTrialMaxDebit",
          Status.WARN,
          Long.toString(gameplay.maxDebitMinorPerTx())
      ));
    } else {
      checks.add(new Check("smpTrialMaxDebit", Status.PASS, Long.toString(SMP_TRIAL_MAX_DEBIT_MINOR)));
    }
    if (gameplay.maxBatchSize() > SMP_TRIAL_MAX_BATCH_SIZE) {
      checks.add(new Check("smpTrialBatchSize", Status.WARN, Integer.toString(gameplay.maxBatchSize())));
    } else {
      checks.add(new Check("smpTrialBatchSize", Status.PASS, Integer.toString(gameplay.maxBatchSize())));
    }
    if (gameplay.bufferSize() > SMP_TRIAL_BUFFER_SIZE) {
      checks.add(new Check("smpTrialBufferSize", Status.WARN, Integer.toString(gameplay.bufferSize())));
    } else {
      checks.add(new Check("smpTrialBufferSize", Status.PASS, Integer.toString(gameplay.bufferSize())));
    }
  }

  private static void addApiChecks(List<Check> checks, Mode mode, ApiProbeResult apiResult) {
    if (!apiResult.attempted()) {
      checks.add(new Check("apiReachable", Status.WARN, apiResult.failureMessage()));
      checks.add(new Check("dbPolicyWritePermissionNotProven", Status.WARN, "api-skipped"));
      return;
    }
    if (!apiResult.reachable()) {
      checks.add(new Check("apiReachable", Status.FAIL, apiResult.failureMessage()));
      checks.add(new Check("hmacAuth", Status.FAIL, "unreachable"));
      checks.add(new Check("dbPolicyWritePermissionNotProven", Status.WARN,
          "DB policy cannot be proven without a write; verify economy_server_policies manually."));
      return;
    }
    checks.add(new Check("apiReachable", Status.PASS, "ok"));
    checks.add(new Check(
        "hmacAuth",
        apiResult.hmacAccepted() ? Status.PASS : Status.FAIL,
        apiResult.hmacAccepted() ? "ok" : apiResult.failureMessage()
    ));
    if (apiResult.balanceReadOk()) {
      checks.add(new Check("balanceRead", Status.PASS, "ok"));
    } else {
      checks.add(new Check("balanceRead", Status.WARN, apiResult.failureMessage()));
    }
    if (mode == Mode.LIVE) {
      checks.add(new Check(
          "dbPolicyWritePermissionNotProven",
          Status.WARN,
          "DB policy cannot be proven without a write; verify economy_server_policies manually."
      ));
    }
  }

  private static void addQueuePressureCheck(List<Check> checks, String id, int depth, int max) {
    if (max <= 0) {
      checks.add(new Check(id, Status.WARN, "max=0"));
      return;
    }
    double ratio = depth / (double) max;
    if (depth >= max) {
      checks.add(new Check(id, Status.FAIL, depth + "/" + max));
    } else if (ratio >= QUEUE_NEAR_RATIO) {
      checks.add(new Check(id, Status.WARN, depth + "/" + max));
    } else {
      checks.add(new Check(id, Status.PASS, depth + "/" + max));
    }
  }

  private static Check boolCheck(String id, boolean actual, String expected) {
    return new Check(id, actual ? Status.PASS : Status.FAIL, actual ? expected : "false");
  }

  private static Check capCheck(String id, long value, long min, long max) {
    if (value < min || value > max) {
      return new Check(id, Status.FAIL, Long.toString(value));
    }
    return new Check(id, Status.PASS, Long.toString(value));
  }

  public static RuntimeProbe runtimeProbeFromPlugin(org.bukkit.plugin.Plugin plugin) {
    return new BukkitRuntimeProbe(plugin);
  }

  private static final class BukkitRuntimeProbe implements RuntimeProbe {
    private final org.bukkit.plugin.Plugin plugin;

    private BukkitRuntimeProbe(org.bukkit.plugin.Plugin plugin) {
      this.plugin = plugin;
    }

    @Override
    public boolean vaultInstalled() {
      return plugin.getServer().getPluginManager().getPlugin("Vault") != null;
    }

    @Override
    public boolean vaultEconomyProviderRegistered() {
      try {
        Class<?> economyClass = Class.forName("net.milkbowl.vault.economy.Economy");
        return plugin.getServer().getServicesManager().getRegistration(economyClass) != null;
      } catch (ClassNotFoundException error) {
        return false;
      }
    }

    @Override
    public boolean economyShopGuiPresent() {
      var manager = plugin.getServer().getPluginManager();
      return manager.getPlugin("EconomyShopGUI") != null || manager.getPlugin("EconomyShopGUI-Premium") != null;
    }

    @Override
    public boolean placeholderApiPresent() {
      return plugin.getServer().getPluginManager().getPlugin("PlaceholderAPI") != null;
    }

    @Override
    public boolean luckPermsPresent() {
      return plugin.getServer().getPluginManager().getPlugin("LuckPerms") != null;
    }
  }

  private static RuntimeProbe unavailableRuntimeProbe() {
    return new RuntimeProbe() {
      @Override public boolean vaultInstalled() { return false; }
      @Override public boolean vaultEconomyProviderRegistered() { return false; }
      @Override public boolean economyShopGuiPresent() { return false; }
      @Override public boolean placeholderApiPresent() { return false; }
      @Override public boolean luckPermsPresent() { return false; }
    };
  }
}
