package com.realfiction.realcore.stats;

import com.realfiction.realcore.api.PlatformApiException;
import com.realfiction.realcore.api.dto.StatEventsRequest;
import com.realfiction.realcore.api.dto.StatEventsResponse;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.config.StatsConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Buffered, async, Folia-safe implementation of {@link NetworkStatWriter}.
 *
 * <h2>Threading model</h2>
 * <ul>
 *   <li>{@link #increment} / {@link #set} are non-blocking and only touch a
 *       {@link ConcurrentHashMap}. They are safe from any region or main thread.</li>
 *   <li>The flush loop runs on the async scheduler. The HTTP call is itself
 *       async (the API client returns a {@link java.util.concurrent.CompletableFuture}),
 *       but we serialize one in-flight flush at a time via {@link #flushRunning}.</li>
 *   <li>The Bukkit API is never touched from this class.</li>
 * </ul>
 *
 * <h2>Idempotency &amp; retries</h2>
 * <p>Each drained batch is assigned a fresh {@link UUID} {@code batchId}. The
 * server's {@code apply_network_stat_events} RPC dedupes on {@code batchId} via
 * {@code network_stat_batches}, so reusing a {@code batchId} after a transient
 * failure is a no-op on the second arrival. Failure handling:
 * <ul>
 *   <li><b>5xx / network errors</b>: the batch is pushed onto a retry deque
 *       <em>with the same {@code batchId}</em>. New events keep accumulating in
 *       the working buffer; they get their own future {@code batchId}. The
 *       retry deque is drained oldest-first on the next flush. We stop sending
 *       on the first retry failure of a flush cycle to avoid hammering a sick
 *       backend.</li>
 *   <li><b>4xx</b>: the batch is dropped and {@link #droppedBatchCount}
 *       incremented; we log once at warning. A 4xx means the payload itself was
 *       rejected (validation, auth, prefix-allowlist) - retrying won't help.</li>
 *   <li><b>Backpressure</b>: if the working buffer + retry deque event totals
 *       exceed {@link StatsConfig.WriterConfig#bufferSize}, new events are
 *       dropped and {@link #droppedEventCount} is incremented. If the retry
 *       deque grows past {@link #MAX_PENDING_BATCHES} we drop the oldest pending
 *       batch and increment {@link #droppedBatchCount}.</li>
 * </ul>
 */
public final class BufferedNetworkStatWriter implements NetworkStatWriter {
  /**
   * Soft cap on retry-pending batches. Past this, we drop the oldest. Sized so a
   * 30-second flush cycle can survive ~5 minutes of backend downtime before
   * dropping batches.
   */
  static final int MAX_PENDING_BATCHES = 12;

  private final RealCoreConfig config;
  private final StatsConfig.WriterConfig writerConfig;
  private final RealCoreScheduler scheduler;
  private final StatEventsTransport transport;
  private final Logger logger;

  private final ConcurrentHashMap<EventKey, AggregatedEvent> working = new ConcurrentHashMap<>();
  private final Deque<PendingBatch> pending = new ArrayDeque<>();
  private final Object pendingLock = new Object();

  private final AtomicBoolean running = new AtomicBoolean(false);
  private final AtomicBoolean flushRunning = new AtomicBoolean(false);
  private final AtomicInteger workingEventCount = new AtomicInteger();
  private final AtomicInteger pendingEventCount = new AtomicInteger();
  private final AtomicInteger flushSuccessCount = new AtomicInteger();
  private final AtomicInteger flushFailureCount = new AtomicInteger();
  private final AtomicInteger duplicateBatchCount = new AtomicInteger();
  private final AtomicInteger droppedEventCount = new AtomicInteger();
  private final AtomicInteger droppedBatchCount = new AtomicInteger();
  private final AtomicLong lastFlushAtMillis = new AtomicLong();
  private volatile String lastFailureMessage = "";
  private ScheduledTaskHandle flushHandle;

  public BufferedNetworkStatWriter(RealCoreConfig config, StatsConfig.WriterConfig writerConfig,
                                   RealCoreScheduler scheduler, StatEventsTransport transport, Logger logger) {
    this.config = Objects.requireNonNull(config, "config");
    this.writerConfig = Objects.requireNonNull(writerConfig, "writerConfig");
    this.scheduler = Objects.requireNonNull(scheduler, "scheduler");
    this.transport = Objects.requireNonNull(transport, "transport");
    this.logger = Objects.requireNonNull(logger, "logger");
  }

  public void start() {
    if (!running.compareAndSet(false, true)) {
      return;
    }
    long period = writerConfig.flushIntervalSeconds();
    flushHandle = scheduler.runAsyncRepeating(this::flushSafely, Math.min(5, period), period);
  }

  public void stop() {
    if (!running.compareAndSet(true, false)) {
      return;
    }
    if (flushHandle != null) {
      flushHandle.cancel();
      flushHandle = null;
    }
    working.clear();
    workingEventCount.set(0);
    synchronized (pendingLock) {
      pending.clear();
      pendingEventCount.set(0);
    }
  }

  // ---- Producer entry points ----------------------------------------------

  @Override
  public void increment(String statKey, UUID subject, String displayName, long delta) {
    if (!running.get() || statKey == null || statKey.isBlank() || subject == null || delta <= 0) {
      return;
    }
    accumulate(statKey, "player", subject.toString(), displayName, delta, "increment");
  }

  @Override
  public void set(String statKey, UUID subject, String displayName, double value) {
    if (!running.get() || statKey == null || statKey.isBlank() || subject == null) {
      return;
    }
    if (!Double.isFinite(value)) {
      return;
    }
    accumulate(statKey, "player", subject.toString(), displayName, value, "set");
  }

  @Override
  public void requestFlush() {
    // Flush is non-blocking even when we call it inline: everything until the
    // HTTP send is concurrent map work, and the HTTP call itself returns a
    // future. flushRunning gates concurrent attempts so this is safe from any
    // thread, including a region/main thread.
    if (running.get()) {
      flushOnce();
    }
  }

  private void accumulate(String statKey, String subjectType, String subjectId, String displayName,
                          double value, String mode) {
    EventKey key = new EventKey(statKey.toLowerCase(Locale.ROOT), subjectType, subjectId, mode);
    int totalQueued = workingEventCount.get() + pendingEventCount.get();
    boolean[] inserted = {false};
    boolean[] dropped = {false};
    working.compute(key, (k, prev) -> {
      if (prev == null) {
        if (totalQueued >= writerConfig.bufferSize()) {
          dropped[0] = true;
          return null;
        }
        inserted[0] = true;
        return new AggregatedEvent(displayName, value);
      }
      if ("increment".equals(mode)) {
        return prev.merged(displayName, prev.value + value);
      }
      return prev.merged(displayName, value);
    });
    if (inserted[0]) {
      workingEventCount.incrementAndGet();
    }
    if (dropped[0]) {
      droppedEventCount.incrementAndGet();
    }
  }

  // ---- Flush loop ---------------------------------------------------------

  private void flushSafely() {
    if (!running.get()) {
      return;
    }
    flushOnce();
  }

  void flushOnce() {
    if (!running.get() || !flushRunning.compareAndSet(false, true)) {
      return;
    }
    try {
      drainAndSend();
    } catch (RuntimeException error) {
      logger.log(Level.WARNING, "stat writer flush crashed", error);
      flushRunning.set(false);
    }
  }

  private void drainAndSend() {
    if (!config.hmacSecretConfigured()) {
      flushRunning.set(false);
      return;
    }

    PendingBatch nextRetry;
    synchronized (pendingLock) {
      nextRetry = pending.peekFirst();
    }
    if (nextRetry != null) {
      sendBatch(nextRetry, true);
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
    List<StatEventsRequest.Event> events = new ArrayList<>(Math.min(working.size(), 500));
    for (Map.Entry<EventKey, AggregatedEvent> entry : working.entrySet()) {
      EventKey key = entry.getKey();
      AggregatedEvent agg = working.remove(key);
      if (agg == null) {
        continue;
      }
      workingEventCount.decrementAndGet();
      events.add(new StatEventsRequest.Event(
          key.statKey, key.subjectType, key.subjectId, agg.displayName, agg.value, key.mode));
      if (events.size() >= 500) {
        break;
      }
    }
    if (events.isEmpty()) {
      return null;
    }
    return new PendingBatch(UUID.randomUUID().toString(), events);
  }

  private void sendBatch(PendingBatch batch, boolean fromRetryDeque) {
    StatEventsRequest request = new StatEventsRequest(config.serverId(), batch.batchId, batch.events);
    transport.send(request).whenComplete((response, error) -> {
      try {
        handleSendResult(batch, fromRetryDeque, response, error);
      } finally {
        flushRunning.set(false);
      }
    });
  }

  private void handleSendResult(PendingBatch batch, boolean fromRetryDeque,
                                StatEventsResponse response, Throwable error) {
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

  private void onBatchAccepted(PendingBatch batch, boolean fromRetryDeque, StatEventsResponse response) {
    if (fromRetryDeque) {
      removeFromPending(batch);
    }
    if (response != null && response.duplicate) {
      duplicateBatchCount.incrementAndGet();
    } else {
      flushSuccessCount.incrementAndGet();
    }
    lastFailureMessage = "";
    lastFlushAtMillis.set(System.currentTimeMillis());
  }

  private void onClientError(PendingBatch batch, boolean fromRetryDeque, PlatformApiException error) {
    if (fromRetryDeque) {
      removeFromPending(batch);
    }
    droppedBatchCount.incrementAndGet();
    flushFailureCount.incrementAndGet();
    lastFailureMessage = "HTTP " + error.statusCode() + ": " + safeMessage(error);
    logger.warning("stat writer dropped batch " + batch.batchId + " (" + batch.events.size()
        + " events): HTTP " + error.statusCode() + " " + safeMessage(error));
  }

  private void onTransientError(PendingBatch batch, boolean fromRetryDeque, Throwable error) {
    flushFailureCount.incrementAndGet();
    lastFailureMessage = "transient: " + safeMessage(error);
    if (config.debug()) {
      logger.log(Level.WARNING, "stat writer transient failure on batch " + batch.batchId, error);
    }
    if (fromRetryDeque) {
      return;
    }
    pushPending(batch);
  }

  private void pushPending(PendingBatch batch) {
    synchronized (pendingLock) {
      while (pending.size() >= MAX_PENDING_BATCHES) {
        PendingBatch evicted = pending.pollFirst();
        if (evicted == null) {
          break;
        }
        pendingEventCount.addAndGet(-evicted.events.size());
        droppedBatchCount.incrementAndGet();
        droppedEventCount.addAndGet(evicted.events.size());
        logger.warning("stat writer overflow: evicted oldest pending batch " + evicted.batchId
            + " (" + evicted.events.size() + " events)");
      }
      pending.addLast(batch);
      pendingEventCount.addAndGet(batch.events.size());
    }
  }

  private void removeFromPending(PendingBatch batch) {
    synchronized (pendingLock) {
      if (pending.removeFirstOccurrence(batch)) {
        pendingEventCount.addAndGet(-batch.events.size());
      }
    }
  }

  // ---- Observability ------------------------------------------------------

  public int queuedEventCount() {
    return workingEventCount.get() + pendingEventCount.get();
  }

  public int workingEventCountSnapshot() {
    return workingEventCount.get();
  }

  public int pendingBatchCount() {
    synchronized (pendingLock) {
      return pending.size();
    }
  }

  public int flushSuccessCount() {
    return flushSuccessCount.get();
  }

  public int flushFailureCount() {
    return flushFailureCount.get();
  }

  public int duplicateBatchCount() {
    return duplicateBatchCount.get();
  }

  public int droppedEventCount() {
    return droppedEventCount.get();
  }

  public int droppedBatchCount() {
    return droppedBatchCount.get();
  }

  public long lastFlushAgoSeconds() {
    long stamp = lastFlushAtMillis.get();
    return stamp == 0L ? -1L : (System.currentTimeMillis() - stamp) / 1000L;
  }

  public String lastFailureMessage() {
    return lastFailureMessage;
  }

  public long flushIntervalSeconds() {
    return writerConfig.flushIntervalSeconds();
  }

  public int bufferSize() {
    return writerConfig.bufferSize();
  }

  public boolean running() {
    return running.get();
  }

  // ---- Internals ----------------------------------------------------------

  private static Throwable unwrap(Throwable error) {
    Throwable cursor = error;
    while (cursor.getCause() != null && cursor != cursor.getCause()) {
      cursor = cursor.getCause();
    }
    return cursor;
  }

  private static String safeMessage(Throwable error) {
    String message = error.getMessage();
    if (message == null || message.isBlank()) {
      return error.getClass().getSimpleName();
    }
    return message;
  }

  private record EventKey(String statKey, String subjectType, String subjectId, String mode) {
  }

  private static final class AggregatedEvent {
    private final String displayName;
    private final double value;

    private AggregatedEvent(String displayName, double value) {
      this.displayName = displayName;
      this.value = value;
    }

    private AggregatedEvent merged(String newDisplayName, double newValue) {
      String preferred = (newDisplayName == null || newDisplayName.isBlank()) ? this.displayName : newDisplayName;
      return new AggregatedEvent(preferred, newValue);
    }
  }

  private static final class PendingBatch {
    private final String batchId;
    private final List<StatEventsRequest.Event> events;

    private PendingBatch(String batchId, List<StatEventsRequest.Event> events) {
      this.batchId = batchId;
      this.events = events;
    }
  }
}
