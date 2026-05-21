package com.realfiction.realcore.api.dto;

import java.util.List;

public final class AckRewardsRequest {
  public final String serverId;
  public final List<Delivery> deliveries;

  public AckRewardsRequest(String serverId, List<Delivery> deliveries) {
    this.serverId = serverId;
    this.deliveries = deliveries;
  }

  public static final class Delivery {
    public final String rewardId;
    public final String status;
    public final String failureReason;

    public Delivery(String rewardId, String status, String failureReason) {
      this.rewardId = rewardId;
      this.status = status;
      this.failureReason = failureReason;
    }
  }
}
