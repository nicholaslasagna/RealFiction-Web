package com.realfiction.realcore.economy;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Gameplay-only writer metrics. Vote rewards use {@link VoteRewardLedgerWriteService}
 * and must not increment these counters.
 */
public final class GameplayEconomyWriterMetrics {
  private final AtomicLong gameplayQueued = new AtomicLong();
  private final AtomicLong gameplaySucceeded = new AtomicLong();
  private final AtomicLong gameplayDuplicates = new AtomicLong();
  private final AtomicLong gameplayFailures = new AtomicLong();
  private final AtomicLong gameplayDropped = new AtomicLong();
  private final AtomicLong gameplayPermanentRejects = new AtomicLong();
  private final AtomicLong gameplayTransientFailures = new AtomicLong();

  private final AtomicLong dryRunSimulatedQueued = new AtomicLong();
  private final AtomicLong dryRunSimulatedBatches = new AtomicLong();
  private final AtomicLong dryRunSimulatedTransactions = new AtomicLong();
  private final AtomicLong dryRunEstimatedVolumeMinor = new AtomicLong();
  private final AtomicLong dryRunWindowStartedAtMillis = new AtomicLong();
  private final AtomicInteger dryRunWindowEventCount = new AtomicInteger();

  public void recordGameplayQueued() {
    gameplayQueued.incrementAndGet();
  }

  public void recordGameplayQueued(int count) {
    gameplayQueued.addAndGet(count);
  }

  public void recordGameplaySucceeded(int count) {
    if (count > 0) {
      gameplaySucceeded.addAndGet(count);
    }
  }

  public void recordGameplayDuplicates(int count) {
    if (count > 0) {
      gameplayDuplicates.addAndGet(count);
    }
  }

  public void recordGameplayFailure(int count) {
    if (count > 0) {
      gameplayFailures.addAndGet(count);
    }
  }

  public void recordGameplayDropped(int count) {
    if (count > 0) {
      gameplayDropped.addAndGet(count);
    }
  }

  public void recordGameplayPermanentReject(int count) {
    if (count > 0) {
      gameplayPermanentRejects.addAndGet(count);
      gameplayFailures.addAndGet(count);
    }
  }

  public void recordGameplayTransientFailure(int count) {
    if (count > 0) {
      gameplayTransientFailures.addAndGet(count);
      gameplayFailures.addAndGet(count);
    }
  }

  public void recordDryRunSimulatedTransaction(long amountMinor) {
    dryRunSimulatedQueued.incrementAndGet();
    dryRunSimulatedTransactions.incrementAndGet();
    dryRunEstimatedVolumeMinor.addAndGet(Math.max(0, amountMinor));
    dryRunWindowEventCount.incrementAndGet();
    long now = System.currentTimeMillis();
    dryRunWindowStartedAtMillis.compareAndSet(0, now);
  }

  public void recordDryRunSimulatedBatch(int transactionsInWindow) {
    if (transactionsInWindow <= 0) {
      return;
    }
    dryRunSimulatedBatches.incrementAndGet();
    dryRunWindowEventCount.set(0);
    dryRunWindowStartedAtMillis.set(System.currentTimeMillis());
  }

  public long gameplayQueued() {
    return gameplayQueued.get();
  }

  public long gameplaySucceeded() {
    return gameplaySucceeded.get();
  }

  public long gameplayDuplicates() {
    return gameplayDuplicates.get();
  }

  public long gameplayFailures() {
    return gameplayFailures.get();
  }

  public long gameplayDropped() {
    return gameplayDropped.get();
  }

  public long gameplayPermanentRejects() {
    return gameplayPermanentRejects.get();
  }

  public long gameplayTransientFailures() {
    return gameplayTransientFailures.get();
  }

  public long dryRunSimulatedQueued() {
    return dryRunSimulatedQueued.get();
  }

  public long dryRunSimulatedBatches() {
    return dryRunSimulatedBatches.get();
  }

  public long dryRunSimulatedTransactions() {
    return dryRunSimulatedTransactions.get();
  }

  public long dryRunEstimatedVolumeMinor() {
    return dryRunEstimatedVolumeMinor.get();
  }

  public double dryRunEstimatedTransactionsPerMinute() {
    long windowMs = dryRunWindowAgeMillis();
    int events = dryRunWindowEventCount.get();
    if (windowMs <= 0 || events <= 0) {
      return 0;
    }
    return events * 60_000.0 / windowMs;
  }

  public double dryRunEstimatedRequestsPerMinute(int flushSeconds) {
    double txPerMin = dryRunEstimatedTransactionsPerMinute();
    if (txPerMin <= 0 || flushSeconds <= 0) {
      return 0;
    }
    int batchSize = Math.max(1, 50);
    return txPerMin / batchSize * (60.0 / flushSeconds);
  }

  private long dryRunWindowAgeMillis() {
    long started = dryRunWindowStartedAtMillis.get();
    return started <= 0 ? 0 : Math.max(1, System.currentTimeMillis() - started);
  }
}
