package com.realfiction.realcore.rewards;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.api.dto.AckRewardsResponse;
import org.junit.jupiter.api.Test;

final class RewardAckRetryPolicyTest {
  @Test
  void retriesWhenAckRequestFails() {
    assertTrue(RewardAckRetryPolicy.shouldRetry(null, new RuntimeException("network down")));
  }

  @Test
  void retriesWhenResponseIsMissingOrRejected() {
    assertTrue(RewardAckRetryPolicy.shouldRetry(null, null));

    AckRewardsResponse rejected = new AckRewardsResponse();
    rejected.accepted = false;
    assertTrue(RewardAckRetryPolicy.shouldRetry(rejected, null));
  }

  @Test
  void doesNotRetryAcceptedResponse() {
    AckRewardsResponse accepted = new AckRewardsResponse();
    accepted.accepted = true;

    assertFalse(RewardAckRetryPolicy.shouldRetry(accepted, null));
  }

  @Test
  void firstRetriesUseNormalCadence() {
    // null random -> deterministic (no jitter).
    assertEquals(30_000L, RewardAckRetryPolicy.backoffMillis(1, 30_000L, null));
    assertEquals(30_000L, RewardAckRetryPolicy.backoffMillis(2, 30_000L, null));
  }

  @Test
  void laterRetriesBackOffExponentiallyAndCap() {
    assertEquals(60_000L, RewardAckRetryPolicy.backoffMillis(3, 30_000L, null)); // base * 2^1
    assertEquals(120_000L, RewardAckRetryPolicy.backoffMillis(4, 30_000L, null)); // base * 2^2
    assertEquals(240_000L, RewardAckRetryPolicy.backoffMillis(5, 30_000L, null)); // base * 2^3
    // Far out attempts are clamped to the cap.
    assertEquals(RewardAckRetryPolicy.BACKOFF_CAP_MILLIS, RewardAckRetryPolicy.backoffMillis(100, 30_000L, null));
  }

  @Test
  void backoffRespectsBaseFloor() {
    assertEquals(RewardAckRetryPolicy.BASE_FLOOR_MILLIS, RewardAckRetryPolicy.backoffMillis(1, 100L, null));
  }
}
