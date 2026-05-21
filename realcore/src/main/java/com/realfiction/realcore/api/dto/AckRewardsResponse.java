package com.realfiction.realcore.api.dto;

import java.util.ArrayList;
import java.util.List;

public final class AckRewardsResponse {
  public boolean accepted;
  public List<Result> results = new ArrayList<>();
  public String error;

  public static final class Result {
    public String rewardId;
    public boolean accepted;
    public String status;
    public String deliveredAt;
    public String failedAt;
    public boolean duplicate;
    public String error;
  }
}
