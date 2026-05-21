package com.realfiction.realcore.api.dto;

import java.util.List;

public final class PollRewardsRequest {
  public final String serverId;
  public final String serverGroup;
  public final int limit;
  public final List<String> capabilities;

  public PollRewardsRequest(String serverId, String serverGroup, int limit, List<String> capabilities) {
    this.serverId = serverId;
    this.serverGroup = serverGroup;
    this.limit = limit;
    this.capabilities = capabilities;
  }
}
