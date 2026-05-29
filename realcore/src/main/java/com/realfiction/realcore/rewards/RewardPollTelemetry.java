package com.realfiction.realcore.rewards;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/** Thread-safe reward poll/delivery counters for /rf rewards and /rf doctor. */
public final class RewardPollTelemetry {
  private final AtomicLong lastPollAtMillis = new AtomicLong(0L);
  private final AtomicInteger lastPollHttpStatus = new AtomicInteger(0);
  private final AtomicReference<String> lastPollError = new AtomicReference<>("");
  private final AtomicReference<String> lastDeliveryFailure = new AtomicReference<>("");
  private final AtomicReference<String> lastDeliveredRewardId = new AtomicReference<>("");
  private final AtomicInteger deliveredCount = new AtomicInteger(0);
  private final AtomicInteger failedCount = new AtomicInteger(0);
  private final AtomicInteger pollSuccessCount = new AtomicInteger(0);
  private final AtomicInteger pollFailureCount = new AtomicInteger(0);

  public void recordPollSuccess(int httpStatus) {
    lastPollAtMillis.set(System.currentTimeMillis());
    lastPollHttpStatus.set(httpStatus);
    lastPollError.set("");
    pollSuccessCount.incrementAndGet();
  }

  public void recordPollFailure(Throwable error, int httpStatus) {
    lastPollAtMillis.set(System.currentTimeMillis());
    lastPollHttpStatus.set(httpStatus);
    lastPollError.set(error == null ? "unknown" : cleanMessage(error));
    pollFailureCount.incrementAndGet();
  }

  public void recordDelivered(String rewardId) {
    deliveredCount.incrementAndGet();
    if (rewardId != null && !rewardId.isBlank()) {
      lastDeliveredRewardId.set(rewardId);
    }
  }

  public void recordFailed(String rewardId, String reason) {
    failedCount.incrementAndGet();
    if (reason != null && !reason.isBlank()) {
      lastDeliveryFailure.set(reason);
    }
    if (rewardId != null && !rewardId.isBlank()) {
      lastDeliveredRewardId.set(rewardId + " (failed)");
    }
  }

  public Instant lastPollAt() {
    long value = lastPollAtMillis.get();
    return value <= 0L ? null : Instant.ofEpochMilli(value);
  }

  public int lastPollHttpStatus() {
    return lastPollHttpStatus.get();
  }

  public String lastPollError() {
    return lastPollError.get();
  }

  public String lastDeliveryFailure() {
    return lastDeliveryFailure.get();
  }

  public String lastDeliveredRewardId() {
    return lastDeliveredRewardId.get();
  }

  public int deliveredCount() {
    return deliveredCount.get();
  }

  public int failedCount() {
    return failedCount.get();
  }

  public int pollSuccessCount() {
    return pollSuccessCount.get();
  }

  public int pollFailureCount() {
    return pollFailureCount.get();
  }

  private static String cleanMessage(Throwable error) {
    Throwable cursor = error;
    while (cursor.getCause() != null) {
      cursor = cursor.getCause();
    }
    String message = cursor.getMessage();
    return message == null || message.isBlank() ? cursor.getClass().getSimpleName() : message;
  }
}
