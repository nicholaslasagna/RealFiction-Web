package com.realfiction.realcore.api.dto;

public final class StatLeaderboardRequest {
  public final String serverId;
  public final String statKey;
  public final String subjectType;
  public final int limit;
  public final int maxAgeSeconds;

  public StatLeaderboardRequest(String serverId, String statKey, String subjectType, int limit, int maxAgeSeconds) {
    this.serverId = serverId;
    this.statKey = statKey;
    this.subjectType = subjectType;
    this.limit = limit;
    this.maxAgeSeconds = maxAgeSeconds;
  }
}
