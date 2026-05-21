package com.realfiction.realcore.rewards;

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
}
