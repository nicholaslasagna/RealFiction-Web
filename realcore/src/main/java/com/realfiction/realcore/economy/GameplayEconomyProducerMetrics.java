package com.realfiction.realcore.economy;

import java.util.concurrent.atomic.AtomicLong;

public final class GameplayEconomyProducerMetrics {
  private final AtomicLong captured = new AtomicLong();
  private final AtomicLong dryRunCaptured = new AtomicLong();
  private final AtomicLong queued = new AtomicLong();
  private final AtomicLong duplicateRejected = new AtomicLong();
  private final AtomicLong invalidRejected = new AtomicLong();
  private final AtomicLong overCapRejected = new AtomicLong();
  private final AtomicLong producerDisabledRejected = new AtomicLong();
  private volatile String lastEventSummary = "";

  public void recordCaptured() {
    captured.incrementAndGet();
  }

  public void recordDryRunCaptured() {
    dryRunCaptured.incrementAndGet();
  }

  public void recordQueued() {
    queued.incrementAndGet();
  }

  public void recordDuplicateRejected() {
    duplicateRejected.incrementAndGet();
  }

  public void recordInvalidRejected() {
    invalidRejected.incrementAndGet();
  }

  public void recordOverCapRejected() {
    overCapRejected.incrementAndGet();
  }

  public void recordProducerDisabledRejected() {
    producerDisabledRejected.incrementAndGet();
  }

  public void setLastEventSummary(String summary) {
    lastEventSummary = summary == null ? "" : summary;
  }

  public long captured() {
    return captured.get();
  }

  public long dryRunCaptured() {
    return dryRunCaptured.get();
  }

  public long queued() {
    return queued.get();
  }

  public long duplicateRejected() {
    return duplicateRejected.get();
  }

  public long invalidRejected() {
    return invalidRejected.get();
  }

  public long overCapRejected() {
    return overCapRejected.get();
  }

  public long producerDisabledRejected() {
    return producerDisabledRejected.get();
  }

  public String lastEventSummary() {
    return lastEventSummary;
  }

  void mergeFrom(GameplayEconomyProducerMetrics other) {
    if (other == null) {
      return;
    }
    captured.addAndGet(other.captured());
    dryRunCaptured.addAndGet(other.dryRunCaptured());
    queued.addAndGet(other.queued());
    duplicateRejected.addAndGet(other.duplicateRejected());
    invalidRejected.addAndGet(other.invalidRejected());
    overCapRejected.addAndGet(other.overCapRejected());
    producerDisabledRejected.addAndGet(other.producerDisabledRejected());
    if (!other.lastEventSummary().isBlank()) {
      lastEventSummary = other.lastEventSummary();
    }
  }
}
