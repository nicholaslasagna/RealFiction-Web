package com.realfiction.realcore.rewards;

import com.realfiction.realcore.api.dto.AckRewardsRequest;

public record RewardDeliveryResult(String rewardId, boolean delivered, String failureReason) {
  public static RewardDeliveryResult delivered(String rewardId) {
    return new RewardDeliveryResult(rewardId, true, null);
  }

  public static RewardDeliveryResult failed(String rewardId, String reason) {
    return new RewardDeliveryResult(rewardId, false, reason == null || reason.isBlank() ? "Reward delivery failed." : reason);
  }

  public AckRewardsRequest.Delivery toAckDelivery() {
    return new AckRewardsRequest.Delivery(rewardId, delivered ? "delivered" : "failed", failureReason);
  }
}
