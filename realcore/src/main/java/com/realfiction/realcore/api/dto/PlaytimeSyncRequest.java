package com.realfiction.realcore.api.dto;

import java.util.List;

public final class PlaytimeSyncRequest {
  public final String serverId;
  public final String serverGroup;
  public final boolean reconcile;
  public final List<Event> events;

  public PlaytimeSyncRequest(String serverId, String serverGroup, boolean reconcile, List<Event> events) {
    this.serverId = serverId;
    this.serverGroup = serverGroup;
    this.reconcile = reconcile;
    this.events = events;
  }

  public static final class Event {
    public final String type;
    public final String sessionId;
    public final String uuid;
    public final String username;
    public final long seconds;

    public Event(String type, String sessionId, String uuid, String username, long seconds) {
      this.type = type;
      this.sessionId = sessionId;
      this.uuid = uuid;
      this.username = username;
      this.seconds = seconds;
    }
  }
}
