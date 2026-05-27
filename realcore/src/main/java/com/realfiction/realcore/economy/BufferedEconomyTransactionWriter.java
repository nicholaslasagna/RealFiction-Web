package com.realfiction.realcore.economy;

import com.realfiction.realcore.api.PlatformApiException;
import com.realfiction.realcore.api.dto.EconomyTransactionsRequest;
import com.realfiction.realcore.api.dto.EconomyTransactionsResponse;
import com.realfiction.realcore.config.EconomyConfig;
import com.realfiction.realcore.config.GameplayEconomyObservabilityConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Async economy transaction buffer.
 *
 * <p>Gameplay producers enqueue via {@link GameplayEconomyTransactionBuffer}.
 * Vote rewards use a separate direct API path and do not use this writer.
 */
public final class BufferedEconomyTransactionWriter {
  private final RealCoreConfig config;
  private final EconomyConfig economyConfig;
  private final RealCoreScheduler scheduler;
  private final EconomyTransactionsTransport transport;
  private final Logger logger;
  private final boolean mutationsAllowed;
  private final int maxPendingBatches;
  private final GameplayEconomyWriterMetrics gameplayMetrics;
  private final GameplayEconomyObservabilityConfig observability;
  private final GameplaySyncLogger syncLogger;

  private final ConcurrentLinkedQueue<EconomyTransaction> working = new ConcurrentLinkedQueue<>();
  private final Deque<PendingBatch> pending = new ArrayDeque<>();
  private final Object pendingLock = new Object();

  private final AtomicBoolean running = new AtomicBoolean(false);
  private final AtomicBoolean flushRunning = new AtomicBoolean(false);
  private final AtomicInteger workingCount = new AtomicInteger();
  private final AtomicInteger pendingCount = new AtomicInteger();
  private final AtomicInteger batchesCreated = new AtomicInteger();
  private final AtomicInteger batchesSent = new AtomicInteger();
  private final AtomicInteger batchesSucceeded = new AtomicInteger();
  private final AtomicInteger batchesFailed = new AtomicInteger();
  private final AtomicInteger batchesRetried = new AtomicInteger();
  private final AtomicInteger transactionsQueued = new AtomicInteger();
  private final AtomicInteger transactionsSucceeded = new AtomicInteger();
  private final AtomicInteger transactionsFailed = new AtomicInteger();
  private final AtomicInteger duplicateTransactions = new AtomicInteger();
  private final AtomicInteger permanentRejectTransactions = new AtomicInteger();
  private final AtomicInteger transientFailureTransactions = new AtomicInteger();
  private final AtomicInteger droppedTransactions = new AtomicInteger();
  private final AtomicInteger queueOverflowDrops = new AtomicInteger();
  private final AtomicInteger sentBatchCount = new AtomicInteger();
  private final AtomicInteger appliedTransactionCount = new AtomicInteger();
  private final AtomicInteger duplicateBatchCount = new AtomicInteger();
  private final AtomicInteger droppedBatchCount = new AtomicInteger();
  private final AtomicInteger largestBatchSize = new AtomicInteger();
  private final AtomicLong totalBatchSize = new AtomicLong();
  private final AtomicInteger batchSizeSamples = new AtomicInteger();
  private final AtomicLong lastSuccessfulFlushAt = new AtomicLong();
  private final AtomicLong lastFailureAt = new AtomicLong();
  private final AtomicLong lastSerializationNanos = new AtomicLong();
  private final AtomicLong lastHttpNanos = new AtomicLong();
  private final AtomicLong lastFlushDurationNanos = new AtomicLong();
  private volatile String lastFailureMessage = "";
  private volatile String lastBatchStatus = "idle";
  private volatile int lastHttpStatus = 0;
  private ScheduledTaskHandle flushTask;

  public BufferedEconomyTransactionWriter(
      RealCoreConfig config,
      EconomyConfig economyConfig,
      RealCoreScheduler scheduler,
      EconomyTransactionsTransport transport,
      Logger logger,
      boolean mutationsAllowed
  ) {
    this(config, economyConfig, scheduler, transport, logger, mutationsAllowed, null, null, null);
  }

  public BufferedEconomyTransactionWriter(
      RealCoreConfig config,
      EconomyConfig economyConfig,
      RealCoreScheduler scheduler,
      EconomyTransactionsTransport transport,
      Logger logger,
      boolean mutationsAllowed,
      GameplayEconomyWriterMetrics gameplayMetrics,
      GameplayEconomyObservabilityConfig observability,
      GameplaySyncLogger syncLogger
  ) {
    this.config = config;
    this.economyConfig = economyConfig;
    this.scheduler = scheduler;
    this.transport = transport;
    this.logger = logger;
    this.mutationsAllowed = mutationsAllowed;
    this.gameplayMetrics = gameplayMetrics;
    GameplayEconomyObservabilityConfig obs = observability == null
        ? GameplayEconomyObservabilityConfig.defaults()
        : observability;
    this.observability = obs;
    this.syncLogger = syncLogger == null ? new GameplaySyncLogger(logger) : syncLogger;
    this.maxPendingBatches = Math.max(1, obs.maxRetryEntries());
  }

  public void start() {
    if (!mutationsAllowed || !running.compareAndSet(false, true)) {
      return;
    }
    long period = economyConfig.flushInterval().toSeconds();
    flushTask = scheduler.runAsyncRepeating(this::flushSafely, Math.min(5, period), period);
  }

  public void stop() {
    if (!running.compareAndSet(true, false)) {
      return;
    }
    if (flushTask != null) {
      flushTask.cancel();
      flushTask = null;
    }
    working.clear();
    workingCount.set(0);
    synchronized (pendingLock) {
      pending.clear();
      pendingCount.set(0);
    }
    lastBatchStatus = "stopped";
  }

  public boolean enqueue(EconomyTransaction transaction) {
    if (!running.get() || transaction == null || !mutationsAllowed) {
      return false;
    }
    int totalQueued = queuedTransactionCount();
    if (totalQueued >= economyConfig.bufferSize()) {
      droppedTransactions.incrementAndGet();
      queueOverflowDrops.incrementAndGet();
      if (isGameplay(transaction)) {
        recordGameplayDropped(1);
        syncLogger.warnOnce("queue-overflow", "gameplay enqueue rejected: global buffer full ("
            + totalQueued + "/" + economyConfig.bufferSize() + ")");
      }
      return false;
    }
    working.add(transaction);
    workingCount.incrementAndGet();
    transactionsQueued.incrementAndGet();
    if (isGameplay(transaction)) {
      recordGameplayQueued(1);
    }
    return true;
  }

  public void requestFlush() {
    if (running.get()) {
      flushOnce();
    }
  }

  void flushOnce() {
    if (!running.get() || !config.hmacSecretConfigured() || !flushRunning.compareAndSet(false, true)) {
      return;
    }
    long flushStart = System.nanoTime();
    try {
      drainAndSend();
    } catch (RuntimeException error) {
      batchesFailed.incrementAndGet();
      lastFailureAt.set(System.currentTimeMillis());
      lastFailureMessage = safeMessage(error);
      lastBatchStatus = "flush-crash";
      syncLogger.error("flush crashed: " + lastFailureMessage);
      logger.log(Level.WARNING, "economy writer flush crashed", error);
      flushRunning.set(false);
      lastFlushDurationNanos.set(System.nanoTime() - flushStart);
    }
  }

  private void flushSafely() {
    if (running.get()) {
      flushOnce();
    }
  }

  private void drainAndSend() {
    PendingBatch retry;
    synchronized (pendingLock) {
      retry = pending.peekFirst();
    }
    if (retry != null) {
      batchesRetried.incrementAndGet();
      sendBatch(retry, true);
      return;
    }

    PendingBatch fresh = drainWorking();
    if (fresh == null) {
      flushRunning.set(false);
      return;
    }
    sendBatch(fresh, false);
  }

  private PendingBatch drainWorking() {
    if (working.isEmpty()) {
      return null;
    }
    List<EconomyTransaction> transactions = new ArrayList<>(economyConfig.maxBatchSize());
    while (transactions.size() < economyConfig.maxBatchSize()) {
      EconomyTransaction tx = working.poll();
      if (tx == null) {
        break;
      }
      workingCount.decrementAndGet();
      transactions.add(tx);
    }
    if (transactions.isEmpty()) {
      return null;
    }
    batchesCreated.incrementAndGet();
    recordBatchSize(transactions.size());
    return new PendingBatch(UUID.randomUUID().toString(), transactions);
  }

  private void sendBatch(PendingBatch batch, boolean fromRetryDeque) {
    long serializeStart = System.nanoTime();
    EconomyTransactionsRequest request;
    try {
      request = new EconomyTransactionsRequest(
          config.serverId(),
          config.serverGroup(),
          economyConfig.currencyKey(),
          batch.batchId,
          batch.transactions.stream().map(this::toDto).toList()
      );
    } catch (RuntimeException error) {
      batchesFailed.incrementAndGet();
      lastFailureAt.set(System.currentTimeMillis());
      lastFailureMessage = "serialization: " + safeMessage(error);
      lastBatchStatus = "serialization-failed";
      syncLogger.error("serialization failure batch=" + batch.batchId + ": " + lastFailureMessage);
      recordBatchGameplayFailures(batch.transactions.size(), true);
      flushRunning.set(false);
      return;
    }
    lastSerializationNanos.set(System.nanoTime() - serializeStart);
    batchesSent.incrementAndGet();
    lastBatchStatus = fromRetryDeque ? "retry-send" : "send";
    long httpStart = System.nanoTime();
    final long flushStartNanos = System.nanoTime();
    transport.send(request).whenComplete((response, error) -> {
      lastHttpNanos.set(System.nanoTime() - httpStart);
      lastFlushDurationNanos.set(System.nanoTime() - flushStartNanos);
      try {
        handleSendResult(batch, fromRetryDeque, response, error);
      } finally {
        flushRunning.set(false);
      }
    });
  }

  private EconomyTransactionsRequest.Transaction toDto(EconomyTransaction transaction) {
    return new EconomyTransactionsRequest.Transaction(
        transaction.minecraftUuid().toString(),
        transaction.minecraftUsername(),
        transaction.amountMinor(),
        transaction.category().apiValue(),
        transaction.reason(),
        transaction.idempotencyKey(),
        transaction.externalRefType(),
        transaction.externalRefId(),
        transaction.metadata() == null ? Map.of() : transaction.metadata()
    );
  }

  private void handleSendResult(PendingBatch batch, boolean fromRetryDeque,
                                EconomyTransactionsResponse response, Throwable error) {
    if (error == null) {
      onBatchAccepted(batch, fromRetryDeque, response);
      return;
    }
    Throwable root = unwrap(error);
    if (root instanceof PlatformApiException api) {
      lastHttpStatus = api.statusCode();
      if (api.statusCode() >= 400 && api.statusCode() < 500) {
        onClientError(batch, fromRetryDeque, api);
        return;
      }
    } else {
      lastHttpStatus = 0;
    }
    onTransientError(batch, fromRetryDeque, root);
  }

  private void onBatchAccepted(PendingBatch batch, boolean fromRetryDeque, EconomyTransactionsResponse response) {
    if (fromRetryDeque) {
      removeFromPending(batch);
    }
    sentBatchCount.incrementAndGet();
    batchesSucceeded.incrementAndGet();
    lastHttpStatus = 200;
    lastBatchStatus = "accepted";
    int applied = 0;
    int duplicates = 0;
    if (response != null) {
      applied = Math.max(0, response.applied);
      duplicates = Math.max(0, response.duplicates);
      appliedTransactionCount.addAndGet(applied);
      duplicateTransactions.addAndGet(duplicates);
      if (response.duplicateBatch) {
        duplicateBatchCount.incrementAndGet();
      }
    }
    transactionsSucceeded.addAndGet(applied + duplicates);
    recordBatchGameplaySuccess(batch.transactions, applied, duplicates);
    if (duplicates > 0 && observability.enabled()) {
      syncLogger.warnOnce("duplicate-storm", "batch " + batch.batchId + " reported " + duplicates + " duplicate txs");
    }
    lastFailureMessage = "";
    lastSuccessfulFlushAt.set(System.currentTimeMillis());
    logSlowFlush(batch.transactions.size());
    syncLogger.batch("accepted batch=" + batch.batchId + " txs=" + batch.transactions.size()
        + " applied=" + applied + " duplicates=" + duplicates);
  }

  private void onClientError(PendingBatch batch, boolean fromRetryDeque, PlatformApiException error) {
    if (fromRetryDeque) {
      removeFromPending(batch);
    }
    droppedBatchCount.incrementAndGet();
    batchesFailed.incrementAndGet();
    lastFailureAt.set(System.currentTimeMillis());
    lastFailureMessage = "HTTP " + error.statusCode() + ": " + safeMessage(error);
    lastBatchStatus = "client-error-" + error.statusCode();
    transactionsFailed.addAndGet(batch.transactions.size());
    permanentRejectTransactions.addAndGet(batch.transactions.size());
    recordBatchGameplayFailures(batch.transactions.size(), true);
    syncLogger.error("permanent API rejection batch=" + batch.batchId + " HTTP " + error.statusCode()
        + " (" + batch.transactions.size() + " txs): " + safeMessage(error));
    if (error.statusCode() == 403 || error.statusCode() == 429) {
      syncLogger.warnOnce("cf-" + error.statusCode(), "Cloudflare/API " + error.statusCode()
          + " on economy batch; fail closed until policy or rate limits recover");
    }
  }

  private void onTransientError(PendingBatch batch, boolean fromRetryDeque, Throwable error) {
    batchesFailed.incrementAndGet();
    lastFailureAt.set(System.currentTimeMillis());
    lastFailureMessage = "transient: " + safeMessage(error);
    lastBatchStatus = "transient-error";
    transientFailureTransactions.addAndGet(batch.transactions.size());
    recordBatchGameplayFailures(batch.transactions.size(), false);
    if (!fromRetryDeque) {
      pushPending(batch);
      syncLogger.warnOnce("retry-exhaustion-risk", "transient failure on batch " + batch.batchId
          + "; queued for retry (" + pendingBatchCount() + "/" + maxPendingBatches + " batches)");
    } else {
      syncLogger.warnOnce("retry-exhaustion", "retry batch " + batch.batchId + " failed again: " + lastFailureMessage);
    }
    if (config.debug()) {
      logger.log(Level.WARNING, "economy writer transient failure on batch " + batch.batchId, error);
    }
  }

  private void pushPending(PendingBatch batch) {
    synchronized (pendingLock) {
      while (pending.size() >= maxPendingBatches) {
        PendingBatch evicted = pending.pollFirst();
        if (evicted == null) {
          break;
        }
        pendingCount.addAndGet(-evicted.transactions.size());
        droppedBatchCount.incrementAndGet();
        droppedTransactions.addAndGet(evicted.transactions.size());
        transactionsFailed.addAndGet(evicted.transactions.size());
        recordBatchGameplayFailures(evicted.transactions.size(), true);
        syncLogger.warnOnce("retry-queue-evict", "evicted oldest retry batch (" + evicted.transactions.size() + " txs)");
      }
      pending.addLast(batch);
      pendingCount.addAndGet(batch.transactions.size());
    }
  }

  private void removeFromPending(PendingBatch batch) {
    synchronized (pendingLock) {
      if (pending.remove(batch)) {
        pendingCount.addAndGet(-batch.transactions.size());
      }
    }
  }

  private void recordBatchSize(int size) {
    largestBatchSize.updateAndGet(current -> Math.max(current, size));
    totalBatchSize.addAndGet(size);
    batchSizeSamples.incrementAndGet();
  }

  private int averageBatchSize() {
    int samples = batchSizeSamples.get();
    if (samples <= 0) {
      return 0;
    }
    return (int) (totalBatchSize.get() / samples);
  }

  private void logSlowFlush(int batchSize) {
    if (!observability.enabled()) {
      return;
    }
    long flushMs = lastFlushDurationNanos.get() / 1_000_000;
    long httpMs = lastHttpNanos.get() / 1_000_000;
    if (flushMs >= observability.slowFlushMs()) {
      syncLogger.warnOnce("slow-flush", "flush took " + flushMs + "ms (batchSize=" + batchSize + ")");
    }
    if (httpMs >= observability.slowHttpMs()) {
      syncLogger.warnOnce("slow-http", "HTTP leg took " + httpMs + "ms");
    }
  }

  private static boolean isGameplay(EconomyTransaction transaction) {
    return transaction != null
        && transaction.idempotencyKey() != null
        && transaction.idempotencyKey().startsWith("gameplay:");
  }

  private void recordGameplayQueued(int count) {
    if (gameplayMetrics != null && count > 0) {
      gameplayMetrics.recordGameplayQueued(count);
    }
  }

  private void recordGameplayDropped(int count) {
    if (gameplayMetrics != null && count > 0) {
      gameplayMetrics.recordGameplayDropped(count);
    }
  }

  private void recordBatchGameplaySuccess(List<EconomyTransaction> transactions, int applied, int duplicates) {
    if (gameplayMetrics == null) {
      return;
    }
    int gameplayCount = countGameplay(transactions);
    if (gameplayCount <= 0) {
      return;
    }
    if (applied > 0) {
      gameplayMetrics.recordGameplaySucceeded(Math.min(applied, gameplayCount));
    }
    if (duplicates > 0) {
      gameplayMetrics.recordGameplayDuplicates(Math.min(duplicates, gameplayCount));
    }
  }

  private void recordBatchGameplayFailures(int transactionCount, boolean permanent) {
    if (gameplayMetrics == null || transactionCount <= 0) {
      return;
    }
    if (permanent) {
      gameplayMetrics.recordGameplayPermanentReject(transactionCount);
    } else {
      gameplayMetrics.recordGameplayTransientFailure(transactionCount);
    }
  }

  private static int countGameplay(List<EconomyTransaction> transactions) {
    int count = 0;
    for (EconomyTransaction tx : transactions) {
      if (isGameplay(tx)) {
        count++;
      }
    }
    return count;
  }

  private static Throwable unwrap(Throwable error) {
    if (error instanceof java.util.concurrent.CompletionException && error.getCause() != null) {
      return error.getCause();
    }
    return error;
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

  public boolean mutationsAllowed() {
    return mutationsAllowed;
  }

  public int queuedTransactionCount() {
    return workingCount.get() + pendingCount.get();
  }

  public int workingTransactionCount() {
    return workingCount.get();
  }

  public int pendingTransactionCount() {
    return pendingCount.get();
  }

  public int pendingBatchCount() {
    synchronized (pendingLock) {
      return pending.size();
    }
  }

  public int batchesCreated() {
    return batchesCreated.get();
  }

  public int batchesSent() {
    return batchesSent.get();
  }

  public int batchesSucceeded() {
    return batchesSucceeded.get();
  }

  public int batchesFailed() {
    return batchesFailed.get();
  }

  public int batchesRetried() {
    return batchesRetried.get();
  }

  public int transactionsQueued() {
    return transactionsQueued.get();
  }

  public int transactionsSucceeded() {
    return transactionsSucceeded.get();
  }

  public int transactionsFailed() {
    return transactionsFailed.get();
  }

  public int duplicateTransactions() {
    return duplicateTransactions.get();
  }

  public int permanentRejectTransactions() {
    return permanentRejectTransactions.get();
  }

  public int transientFailureTransactions() {
    return transientFailureTransactions.get();
  }

  public int droppedTransactions() {
    return droppedTransactions.get();
  }

  public int queueOverflowDrops() {
    return queueOverflowDrops.get();
  }

  public int averageBatchSizeMetric() {
    return averageBatchSize();
  }

  public int largestBatchSize() {
    return largestBatchSize.get();
  }

  public long lastSuccessfulFlushAtMillis() {
    return lastSuccessfulFlushAt.get();
  }

  public long lastFailureAtMillis() {
    return lastFailureAt.get();
  }

  public long lastSerializationMillis() {
    return lastSerializationNanos.get() / 1_000_000;
  }

  public long lastHttpMillis() {
    return lastHttpNanos.get() / 1_000_000;
  }

  public long lastFlushDurationMillis() {
    return lastFlushDurationNanos.get() / 1_000_000;
  }

  public int sentBatchCount() {
    return sentBatchCount.get();
  }

  public int appliedTransactionCount() {
    return appliedTransactionCount.get();
  }

  public int duplicateBatchCount() {
    return duplicateBatchCount.get();
  }

  public int duplicateTransactionCount() {
    return duplicateTransactions.get();
  }

  public int failedBatchCount() {
    return batchesFailed.get();
  }

  public int droppedBatchCount() {
    return droppedBatchCount.get();
  }

  public int droppedTransactionCount() {
    return droppedTransactions.get();
  }

  public long lastFlushAgoSeconds() {
    long at = lastSuccessfulFlushAt.get();
    return at <= 0 ? -1 : Math.max(0, (System.currentTimeMillis() - at) / 1000);
  }

  public String lastFailureMessage() {
    return lastFailureMessage;
  }

  public String lastBatchStatus() {
    return lastBatchStatus;
  }

  public int lastHttpStatus() {
    return lastHttpStatus;
  }

  public String lastFailureReason() {
    return lastFailureMessage;
  }

  public double batchesPerMinuteEstimate() {
    long ago = lastFlushAgoSeconds();
    int sent = batchesSent.get();
    if (sent <= 0 || ago <= 0) {
      return 0;
    }
    return sent * 60.0 / Math.max(1, ago);
  }

  private record PendingBatch(String batchId, List<EconomyTransaction> transactions) {
  }
}
