package com.realfiction.realcore.api.dto;

public final class HeartbeatRequest {
  public final String serverId;
  public final String instanceId;
  public final String serverGroup;
  public final String displayName;
  public final boolean release;

  public HeartbeatRequest(String serverId, String instanceId, String serverGroup, String displayName, boolean release) {
    this.serverId = serverId;
    this.instanceId = instanceId;
    this.serverGroup = serverGroup;
    this.displayName = displayName;
    this.release = release;
  }
}
