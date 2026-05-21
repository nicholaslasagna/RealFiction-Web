package com.realfiction.realcore.api.dto;

import java.util.ArrayList;
import java.util.List;

public final class PollRewardsResponse {
  public ServerInfo server;
  public List<RewardPayload> rewards = new ArrayList<>();
  public String error;

  public static final class ServerInfo {
    public String id;
    public String group;
    public List<String> capabilities = new ArrayList<>();
  }
}
