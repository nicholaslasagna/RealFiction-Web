package com.realfiction.realcore.economy;

import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.api.dto.EconomyBalanceRequest;
import com.realfiction.realcore.api.dto.EconomyBalanceResponse;
import com.realfiction.realcore.config.EconomyConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

/**
 * Disabled-by-default global economy client foundation.
 *
 * <p>Phase 3 only owns HTTP client/buffer/cache plumbing. This service does not
 * register a Vault provider, alter EssentialsX balances, or generate gameplay
 * economy transactions.
 */
public final class EconomyService {
  private final RealCoreConfig config;
  private final EconomyConfig economyConfig;
  private final PlatformApiClient apiClient;
  private final BufferedEconomyTransactionWriter writer;
  private final Logger logger;
  private final Map<UUID, EconomyBalanceSnapshot> balanceCache = new ConcurrentHashMap<>();
  private volatile boolean running;
  private volatile String disabledReason = "";

  public EconomyService(RealCoreConfig config, RealCoreScheduler scheduler, PlatformApiClient apiClient, Logger logger) {
    this.config = config;
    this.economyConfig = config.economy();
    this.apiClient = apiClient;
    this.logger = logger;
    boolean mutationsAllowed = !"anarchy".equalsIgnoreCase(config.serverGroup());
    this.writer = new BufferedEconomyTransactionWriter(
        config,
        economyConfig,
        scheduler,
        apiClient::postEconomyTransactions,
        logger,
        mutationsAllowed
    );
  }

  public void start() {
    if (!economyConfig.enabled()) {
      disabledReason = "economy.enabled is false";
      return;
    }
    if (!config.modules().economy()) {
      disabledReason = "modules.economy is false";
      return;
    }
    if (!config.hmacSecretConfigured()) {
      disabledReason = "website auth is not configured";
      return;
    }
    if ("anarchy".equalsIgnoreCase(config.serverGroup())) {
      disabledReason = "Anarchy is read-only for the global economy";
      logger.warning("Global economy writer is disabled on Anarchy by policy.");
      running = true;
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
    if (minecraftUuid == null) {
      return CompletableFuture.failedFuture(new IllegalArgumentException("minecraftUuid is required"));
    }
    EconomyBalanceSnapshot cached = balanceCache.get(minecraftUuid);
    if (cached != null && !cacheExpired(cached)) {
      return CompletableFuture.completedFuture(cached);
    }
    if (!economyConfig.enabled() || !config.hmacSecretConfigured()) {
      return CompletableFuture.failedFuture(new IllegalStateException("global economy client is disabled"));
    }
    EconomyBalanceRequest request = new EconomyBalanceRequest(
        config.serverId(),
        config.serverGroup(),
        economyConfig.currencyKey(),
        minecraftUuid.toString()
    );
    return apiClient.fetchEconomyBalance(request).thenApply(this::cacheResponse);
  }

  public boolean enqueue(EconomyTransaction transaction) {
    return writer.enqueue(transaction);
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
    return snapshot;
  }

  private boolean cacheExpired(EconomyBalanceSnapshot snapshot) {
    return snapshot.cachedAt().plus(economyConfig.balanceCacheTtl()).isBefore(Instant.now());
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
