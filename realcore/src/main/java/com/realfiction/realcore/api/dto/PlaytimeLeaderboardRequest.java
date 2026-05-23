package com.realfiction.realcore.api.dto;

public final class PlaytimeLeaderboardRequest {
  public final String serverId;
  public final String group;
  public final int limit;

  public PlaytimeLeaderboardRequest(String serverId, String group, int limit) {
    this.serverId = serverId;
    this.group = group;
    this.limit = limit;
  }
}
