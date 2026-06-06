package com.realfiction.realcore.economy;

import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.api.dto.EconomyBalanceRequest;
import com.realfiction.realcore.api.dto.EconomyBalanceResponse;
import com.realfiction.realcore.config.EconomyConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import java.time.Instant;
import java.time.Duration;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Logger;

/**
 * Disabled-by-default global economy client foundation.
 *
 * <p>Phase 3 only owns HTTP client/buffer/cache plumbing. This service does not
 * register a Vault provider, alter EssentialsX balances, or generate gameplay
 * economy transactions.
 */
public final class EconomyService {
  private static final int MAX_BALANCE_CACHE_ENTRIES = 5000;

  private final RealCoreConfig config;
  private final EconomyConfig economyConfig;
  private final EconomyBalanceTransport balanceTransport;
  private final BufferedEconomyTransactionWriter writer;
  private final Logger logger;
  private final Map<UUID, EconomyBalanceSnapshot> balanceCache = new ConcurrentHashMap<>();
  private final AtomicInteger balanceReadSuccesses = new AtomicInteger();
  private final AtomicInteger balanceReadFailures = new AtomicInteger();
  private final AtomicLong balanceReadLatencyTotalMillis = new AtomicLong();
  private final AtomicLong balanceReadLatencyCount = new AtomicLong();
  private final AtomicLong lastBalanceReadLatencyMillis = new AtomicLong();
  private final AtomicLong lastBalanceReadAtMillis = new AtomicLong();
  private volatile boolean running;
  private volatile String disabledReason = "";

  public EconomyService(RealCoreConfig config, RealCoreScheduler scheduler, PlatformApiClient apiClient, Logger logger) {
    this(config, scheduler, apiClient::fetchEconomyBalance, apiClient::postEconomyTransactions, logger, null, null);
  }

  public EconomyService(
      RealCoreConfig config,
      RealCoreScheduler scheduler,
      PlatformApiClient apiClient,
      Logger logger,
      GameplayEconomyWriterMetrics gameplayMetrics,
      GameplaySyncLogger syncLogger
  ) {
    this(config, scheduler, apiClient::fetchEconomyBalance, apiClient::postEconomyTransactions, logger, gameplayMetrics, syncLogger);
  }

  EconomyService(RealCoreConfig config, RealCoreScheduler scheduler, EconomyBalanceTransport balanceTransport,
                 EconomyTransactionsTransport transactionsTransport, Logger logger) {
    this(config, scheduler, balanceTransport, transactionsTransport, logger, null, null);
  }

  EconomyService(RealCoreConfig config, RealCoreScheduler scheduler, EconomyBalanceTransport balanceTransport,
                 EconomyTransactionsTransport transactionsTransport, Logger logger,
                 GameplayEconomyWriterMetrics gameplayMetrics, GameplaySyncLogger syncLogger) {
    this.config = config;
    this.economyConfig = config.economy();
    this.balanceTransport = balanceTransport;
    this.logger = logger;
    boolean mutationsAllowed = !"anarchy".equalsIgnoreCase(config.serverGroup());
    this.writer = new BufferedEconomyTransactionWriter(
        config,
        economyConfig,
        scheduler,
        transactionsTransport,
        logger,
        mutationsAllowed,
        gameplayMetrics,
        economyConfig.gameplaySync().observability(),
        syncLogger
    );
  }

  public void start() {
    if (!config.modules().economy()) {
      disabledReason = "modules.economy is false";
      return;
    }
    if (!config.hmacSecretConfigured()) {
      disabledReason = "website auth is not configured";
      return;
    }
    if ("anarchy".equalsIgnoreCase(config.serverGroup())) {
      disabledReason = "Anarchy is blocked from global economy reads and writes";
      logger.warning("Global economy writer is disabled on Anarchy by policy.");
      running = true;
      return;
    }
    if (!economyConfig.enabled()) {
      disabledReason = dbBalanceReadGuardReason().isBlank()
          ? "economy.enabled is false; DB balance reads are enabled"
          : "economy.enabled is false";
      running = dbBalanceReadGuardReason().isBlank();
      return;
    }
    disabledReason = "";
    running = true;
    writer.start();
  }

  public void stop() {
    running = false;
    writer.stop();
    balanceCache.clear();
  }

  public CompletableFuture<EconomyBalanceSnapshot> fetchBalance(UUID minecraftUuid) {
    return fetchBalanceWithGuard(minecraftUuid, balanceFetchGuardReason(), economyConfig.balanceCacheTtl());
  }

  public CompletableFuture<EconomyBalanceSnapshot> fetchBalanceReadOnly(UUID minecraftUuid) {
    return fetchBalanceWithGuard(minecraftUuid, dbBalanceReadGuardReason(), economyConfig.dbBalanceReadCacheTtl());
  }

  private CompletableFuture<EconomyBalanceSnapshot> fetchBalanceWithGuard(UUID minecraftUuid, String guardReason, Duration ttl) {
    if (minecraftUuid == null) {
      return CompletableFuture.failedFuture(new IllegalArgumentException("minecraftUuid is required"));
    }
    EconomyBalanceSnapshot cached = balanceCache.get(minecraftUuid);
    if (cached != null && !cacheExpired(cached, ttl)) {
      return CompletableFuture.completedFuture(cached);
    }
    if (!guardReason.isBlank()) {
      return CompletableFuture.failedFuture(new IllegalStateException(guardReason));
    }
    EconomyBalanceRequest request = new EconomyBalanceRequest(
        config.serverId(),
        config.serverGroup(),
        economyConfig.currencyKey(),
        minecraftUuid.toString()
    );
    long started = System.nanoTime();
    return balanceTransport.fetch(request)
        .thenApply(response -> {
          EconomyBalanceSnapshot snapshot = cacheResponse(response);
          recordBalanceReadSuccess(started);
          return snapshot;
        })
        .whenComplete((ignored, error) -> {
          if (error != null) {
            recordBalanceReadFailure(started);
          }
        });
  }

  public boolean enqueue(EconomyTransaction transaction) {
    return writer.enqueue(transaction);
  }

  /**
   * Authoritative balance write from the live Vault economy provider. Enqueues an uncapped
   * {@code vault} credit/debit to the shared store via the buffered, retrying writer. The DB
   * computes the new balance authoritatively; idempotencyKey makes a retried write a no-op.
   *
   * @return true if accepted into the write buffer
   */
  public boolean applyVaultDelta(UUID minecraftUuid, String username, long deltaMinor, String reason,
                                 String idempotencyKey) {
    if (deltaMinor == 0) {
      return true;
    }
    long amount = Math.abs(deltaMinor);
    EconomyTransaction transaction = deltaMinor > 0
        ? EconomyTransaction.credit(minecraftUuid, username, amount, EconomyCategory.VAULT_CREDIT,
            reason, idempotencyKey, "vault", null, Map.of())
        : EconomyTransaction.debit(minecraftUuid, username, amount, EconomyCategory.VAULT_DEBIT,
            reason, idempotencyKey, "vault", null, Map.of());
    return enqueue(transaction);
  }

  public void requestFlush() {
    writer.requestFlush();
  }

  public boolean configuredEnabled() {
    return economyConfig.enabled();
  }

  public boolean running() {
    return running;
  }

  public boolean writerRunning() {
    return writer.running();
  }

  public boolean mutationsAllowed() {
    return writer.mutationsAllowed();
  }

  public String disabledReason() {
    return disabledReason;
  }

  public String currencyKey() {
    return economyConfig.currencyKey();
  }

  public long flushIntervalSeconds() {
    return economyConfig.flushInterval().toSeconds();
  }

  public int bufferSize() {
    return economyConfig.bufferSize();
  }

  public int maxBatchSize() {
    return economyConfig.maxBatchSize();
  }

  public int cachedBalanceCount() {
    return balanceCache.size();
  }

  public EconomyBalanceSnapshot cachedBalance(UUID minecraftUuid) {
    return minecraftUuid == null ? null : balanceCache.get(minecraftUuid);
  }

  public boolean dbBalanceReadConfiguredEnabled() {
    return economyConfig.dbBalanceReadEnabled();
  }

  public boolean dbBalanceReadAllowed() {
    return dbBalanceReadGuardReason().isBlank();
  }

  public String dbBalanceReadGuardReason() {
    return dbBalanceReadGuardReason(config);
  }

  public static String dbBalanceReadGuardReason(RealCoreConfig config) {
    if (config == null) {
      return "config is not loaded";
    }
    EconomyConfig economy = config.economy();
    if (!config.modules().economy()) {
      return "modules.economy is false";
    }
    if (!config.hmacSecretConfigured()) {
      return "website auth is not configured";
    }
    if ("anarchy".equalsIgnoreCase(config.serverGroup())) {
      return "Anarchy is blocked from DB economy balance reads";
    }
    if (!economy.dbBalanceReadEnabled()) {
      return "economy.dbBalanceReadEnabled is false";
    }
    String serverId = config.serverId() == null ? "" : config.serverId().toLowerCase(Locale.ROOT);
    if (!economy.dbBalanceReadBackendAllowlist().contains(serverId)) {
      return "server.id is not in economy.dbBalanceReadBackendAllowlist";
    }
    return "";
  }

  public String balanceFetchGuardReason() {
    if (!config.modules().economy()) {
      return "modules.economy is false";
    }
    if (!config.hmacSecretConfigured()) {
      return "website auth is not configured";
    }
    if ("anarchy".equalsIgnoreCase(config.serverGroup())) {
      return "Anarchy is blocked from DB economy balance reads";
    }
    if (economyConfig.enabled()) {
      return "";
    }
    return dbBalanceReadGuardReason();
  }

  public long dbBalanceReadCacheSeconds() {
    return economyConfig.dbBalanceReadCacheTtl().toSeconds();
  }

  public int dbBalanceReadMaxPlayersPerBatch() {
    return economyConfig.dbBalanceReadMaxPlayersPerBatch();
  }

  public String dbBalanceReadAllowlistSummary() {
    return String.join(", ", economyConfig.dbBalanceReadBackendAllowlist());
  }

  public boolean syncVaultFromDbEnabled() {
    return economyConfig.syncVaultFromDbEnabled();
  }

  public String syncVaultFromDbAllowlistSummary() {
    return String.join(", ", economyConfig.syncVaultFromDbBackendAllowlist());
  }

  public int syncVaultFromDbMaxPlayersPerRun() {
    return economyConfig.syncVaultFromDbMaxPlayersPerRun();
  }

  public long syncVaultFromDbMaxDeltaMinor() {
    return economyConfig.syncVaultFromDbMaxDeltaMinor();
  }

  public boolean syncVaultFromDbRequireOnline() {
    return economyConfig.syncVaultFromDbRequireOnline();
  }

  public boolean syncVaultFromDbDryRunDefault() {
    return economyConfig.syncVaultFromDbDryRunDefault();
  }

  public int balanceReadSuccessCount() {
    return balanceReadSuccesses.get();
  }

  public int balanceReadFailureCount() {
    return balanceReadFailures.get();
  }

  public long averageBalanceReadLatencyMillis() {
    long count = balanceReadLatencyCount.get();
    return count <= 0 ? 0 : balanceReadLatencyTotalMillis.get() / count;
  }

  public long lastBalanceReadLatencyMillis() {
    return lastBalanceReadLatencyMillis.get();
  }

  public long lastBalanceReadAgoSeconds() {
    long at = lastBalanceReadAtMillis.get();
    return at <= 0 ? -1 : Math.max(0, (System.currentTimeMillis() - at) / 1000);
  }

  public long stagingTestMaxCreditMinor() {
    return economyConfig.stagingTestMaxCreditMinor();
  }

  public boolean syncVaultAfterDb() {
    return economyConfig.syncVaultAfterDb();
  }

  public long syncVaultMaxDeltaMinor() {
    return economyConfig.syncVaultMaxDeltaMinor();
  }

  public BufferedEconomyTransactionWriter writer() {
    return writer;
  }

  private EconomyBalanceSnapshot cacheResponse(EconomyBalanceResponse response) {
    UUID uuid = UUID.fromString(response.minecraftUuid);
    Instant updatedAt = parseInstant(response.updatedAt);
    EconomyBalanceSnapshot snapshot = new EconomyBalanceSnapshot(
        safeCurrency(response.currencyKey),
        uuid,
        response.minecraftUsername,
        response.balanceMinor,
        response.scale <= 0 ? 100 : response.scale,
        updatedAt,
        Instant.now()
    );
    balanceCache.put(uuid, snapshot);
    pruneBalanceCache();
    return snapshot;
  }

  private boolean cacheExpired(EconomyBalanceSnapshot snapshot, Duration ttl) {
    return snapshot.cachedAt().plus(ttl).isBefore(Instant.now());
  }

  private void recordBalanceReadSuccess(long startedNanos) {
    long elapsed = elapsedMillis(startedNanos);
    balanceReadSuccesses.incrementAndGet();
    lastBalanceReadAtMillis.set(System.currentTimeMillis());
    lastBalanceReadLatencyMillis.set(elapsed);
    balanceReadLatencyTotalMillis.addAndGet(elapsed);
    balanceReadLatencyCount.incrementAndGet();
  }

  private void recordBalanceReadFailure(long startedNanos) {
    long elapsed = elapsedMillis(startedNanos);
    balanceReadFailures.incrementAndGet();
    lastBalanceReadLatencyMillis.set(elapsed);
    balanceReadLatencyTotalMillis.addAndGet(elapsed);
    balanceReadLatencyCount.incrementAndGet();
  }

  private static long elapsedMillis(long startedNanos) {
    return Math.max(0, (System.nanoTime() - startedNanos) / 1_000_000L);
  }

  private void pruneBalanceCache() {
    if (balanceCache.size() <= MAX_BALANCE_CACHE_ENTRIES) {
      return;
    }
    Instant now = Instant.now();
    balanceCache.entrySet().removeIf(entry ->
        entry.getValue().cachedAt().plus(economyConfig.dbBalanceReadCacheTtl()).isBefore(now));
    if (balanceCache.size() <= MAX_BALANCE_CACHE_ENTRIES) {
      return;
    }
    balanceCache.entrySet().stream()
        .sorted(Map.Entry.comparingByValue((left, right) -> left.cachedAt().compareTo(right.cachedAt())))
        .limit(Math.max(0, balanceCache.size() - MAX_BALANCE_CACHE_ENTRIES))
        .map(Map.Entry::getKey)
        .toList()
        .forEach(balanceCache::remove);
  }

  private String safeCurrency(String value) {
    if (value == null || value.isBlank()) {
      return economyConfig.currencyKey();
    }
    return value.trim().toLowerCase(Locale.ROOT);
  }

  private static Instant parseInstant(String value) {
    if (value == null || value.isBlank()) {
      return null;
    }
    try {
      return Instant.parse(value);
    } catch (RuntimeException ignored) {
      return null;
    }
  }
}
