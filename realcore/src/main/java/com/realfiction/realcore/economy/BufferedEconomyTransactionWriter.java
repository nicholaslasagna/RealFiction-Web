package com.realfiction.realcore.economy;

import com.realfiction.realcore.api.PlatformApiException;
import com.realfiction.realcore.api.dto.EconomyTransactionsRequest;
import com.realfiction.realcore.api.dto.EconomyTransactionsResponse;
import com.realfiction.realcore.config.EconomyConfig;
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
 * <p>This is deliberately not wired to any gameplay producer in Phase 3. Future
 * producers may enqueue transactions here; the writer batches them, signs the
 * request through {@link com.realfiction.realcore.api.PlatformApiClient}, and
 * retries transient failures with the same batch id.
 */
public final class BufferedEconomyTransactionWriter {
  static final int MAX_PENDING_BATCHES = 12;

  private final RealCoreConfig config;
  private final EconomyConfig economyConfig;
  private final RealCoreScheduler scheduler;
  private final EconomyTransactionsTransport transport;
  private final Logger logger;
  private final boolean mutationsAllowed;

  private final ConcurrentLinkedQueue<EconomyTransaction> working = new ConcurrentLinkedQueue<>();
  private final Deque<PendingBatch> pending = new ArrayDeque<>();
  private final Object pendingLock = new Object();

  private final AtomicBoolean running = new AtomicBoolean(false);
  private final AtomicBoolean flushRunning = new AtomicBoolean(false);
  private final AtomicInteger workingCount = new AtomicInteger();
  private final AtomicInteger pendingCount = new AtomicInteger();
  private final AtomicInteger sentBatchCount = new AtomicInteger();
  private final AtomicInteger appliedTransactionCount = new AtomicInteger();
  private final AtomicInteger duplicateBatchCount = new AtomicInteger();
  private final AtomicInteger duplicateTransactionCount = new AtomicInteger();
  private final AtomicInteger failedBatchCount = new AtomicInteger();
  private final AtomicInteger droppedBatchCount = new AtomicInteger();
  private final AtomicInteger droppedTransactionCount = new AtomicInteger();
  private final AtomicLong lastFlushAtMillis = new AtomicLong();
  private volatile String lastFailureMessage = "";
  private ScheduledTaskHandle flushTask;

  public BufferedEconomyTransactionWriter(RealCoreConfig config, EconomyConfig economyConfig,
                                          RealCoreScheduler scheduler, EconomyTransactionsTransport transport,
                                          Logger logger, boolean mutationsAllowed) {
    this.config = config;
    this.economyConfig = economyConfig;
    this.scheduler = scheduler;
    this.transport = transport;
    this.logger = logger;
    this.mutationsAllowed = mutationsAllowed;
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
  }

  public boolean enqueue(EconomyTransaction transaction) {
    if (!running.get() || transaction == null || !mutationsAllowed) {
      return false;
    }
    int totalQueued = queuedTransactionCount();
    if (totalQueued >= economyConfig.bufferSize()) {
      droppedTransactionCount.incrementAndGet();
      return false;
    }
    working.add(transaction);
    workingCount.incrementAndGet();
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
    try {
      drainAndSend();
    } catch (RuntimeException error) {
      failedBatchCount.incrementAndGet();
      lastFailureMessage = safeMessage(error);
      logger.log(Level.WARNING, "economy writer flush crashed", error);
      flushRunning.set(false);
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
      sendBatch(retry, true);
      return;
    }

    PendingBatch fresh = drainWorking();
    if (fresh == null) {
      lastFlushAtMillis.set(System.currentTimeMillis());
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
    return new PendingBatch(UUID.randomUUID().toString(), transactions);
  }

  private void sendBatch(PendingBatch batch, boolean fromRetryDeque) {
    EconomyTransactionsRequest request = new EconomyTransactionsRequest(
        config.serverId(),
        config.serverGroup(),
        economyConfig.currencyKey(),
        batch.batchId,
        batch.transactions.stream().map(this::toDto).toList()
    );
    transport.send(request).whenComplete((response, error) -> {
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
    if (root instanceof PlatformApiException api && api.statusCode() >= 400 && api.statusCode() < 500) {
      onClientError(batch, fromRetryDeque, api);
      return;
    }
    onTransientError(batch, fromRetryDeque, root);
  }

  private void onBatchAccepted(PendingBatch batch, boolean fromRetryDeque, EconomyTransactionsResponse response) {
    if (fromRetryDeque) {
      removeFromPending(batch);
    }
    sentBatchCount.incrementAndGet();
    if (response != null) {
      appliedTransactionCount.addAndGet(Math.max(0, response.applied));
      duplicateTransactionCount.addAndGet(Math.max(0, response.duplicates));
      if (response.duplicateBatch) {
        duplicateBatchCount.incrementAndGet();
      }
    }
    lastFailureMessage = "";
    lastFlushAtMillis.set(System.currentTimeMillis());
  }

  private void onClientError(PendingBatch batch, boolean fromRetryDeque, PlatformApiException error) {
    if (fromRetryDeque) {
      removeFromPending(batch);
    }
    droppedBatchCount.incrementAndGet();
    failedBatchCount.incrementAndGet();
    lastFailureMessage = "HTTP " + error.statusCode() + ": " + safeMessage(error);
    logger.warning("economy writer dropped batch " + batch.batchId + " (" + batch.transactions.size()
        + " transactions): HTTP " + error.statusCode() + " " + safeMessage(error));
  }

  private void onTransientError(PendingBatch batch, boolean fromRetryDeque, Throwable error) {
    failedBatchCount.incrementAndGet();
    lastFailureMessage = "transient: " + safeMessage(error);
    if (config.debug()) {
      logger.log(Level.WARNING, "economy writer transient failure on batch " + batch.batchId, error);
    }
    if (!fromRetryDeque) {
      pushPending(batch);
    }
  }

  private void pushPending(PendingBatch batch) {
    synchronized (pendingLock) {
      while (pending.size() >= MAX_PENDING_BATCHES) {
        PendingBatch evicted = pending.pollFirst();
        if (evicted == null) {
          break;
        }
        pendingCount.addAndGet(-evicted.transactions.size());
        droppedBatchCount.incrementAndGet();
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
    return duplicateTransactionCount.get();
  }

  public int failedBatchCount() {
    return failedBatchCount.get();
  }

  public int droppedBatchCount() {
    return droppedBatchCount.get();
  }

  public int droppedTransactionCount() {
    return droppedTransactionCount.get();
  }

  public long lastFlushAgoSeconds() {
    long at = lastFlushAtMillis.get();
    return at <= 0 ? -1 : Math.max(0, (System.currentTimeMillis() - at) / 1000);
  }

  public String lastFailureMessage() {
    return lastFailureMessage;
  }

  private record PendingBatch(String batchId, List<EconomyTransaction> transactions) {
  }
}
