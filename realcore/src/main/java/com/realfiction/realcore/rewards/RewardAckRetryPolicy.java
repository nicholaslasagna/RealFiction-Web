package com.realfiction.realcore.rewards;

import com.realfiction.realcore.api.dto.AckRewardsResponse;
import java.util.random.RandomGenerator;

final class RewardAckRetryPolicy {
  /** Floor for the base cadence so a tiny poll interval cannot busy-retry. */
  static final long BASE_FLOOR_MILLIS = 5_000L;
  /** Upper bound on any single backoff delay. */
  static final long BACKOFF_CAP_MILLIS = 10 * 60_000L;
  /** Retries past this point stay at the cap (prevents overflow). */
  static final int MAX_BACKOFF_EXPONENT = 6;

  private RewardAckRetryPolicy() {
  }

  static boolean shouldRetry(AckRewardsResponse response, Throwable error) {
    return error != null || response == null || !response.accepted;
  }

  /**
   * Bounded backoff for ack retries. The first couple of attempts keep the normal
   * poll cadence; after that the delay grows exponentially (capped) with optional
   * jitter so many stuck rewards do not retry in lockstep.
   *
   * @param attempts attempts already made for this reward (1 = first try)
   * @param baseMillis the poll interval in millis (normal cadence)
   * @param random jitter source; pass {@code null} for a deterministic delay
   */
  static long backoffMillis(int attempts, long baseMillis, RandomGenerator random) {
    long base = Math.max(BASE_FLOOR_MILLIS, baseMillis);
    if (attempts <= 2) {
      return base;
    }
    int exponent = Math.min(attempts - 2, MAX_BACKOFF_EXPONENT);
    long delay = Math.min(BACKOFF_CAP_MILLIS, base * (1L << exponent));
    long jitterBound = Math.max(1L, delay / 4);
    long jitter = random == null ? 0L : random.nextLong(jitterBound);
    return delay + jitter;
  }
}
