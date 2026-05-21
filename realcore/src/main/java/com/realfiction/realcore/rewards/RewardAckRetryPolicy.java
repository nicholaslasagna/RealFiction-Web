package com.realfiction.realcore.rewards;

import com.realfiction.realcore.api.dto.AckRewardsResponse;

final class RewardAckRetryPolicy {
  private RewardAckRetryPolicy() {
  }

  static boolean shouldRetry(AckRewardsResponse response, Throwable error) {
    return error != null || response == null || !response.accepted;
  }
}
