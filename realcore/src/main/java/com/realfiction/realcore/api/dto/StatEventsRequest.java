package com.realfiction.realcore.api.dto;

import java.util.List;

/**
 * Request body for {@code POST /api/plugin/stats/events}.
 *
 * <p>Built by {@code BufferedNetworkStatWriter} when it drains its in-memory
 * buffer. {@link #batchId} is reused on transient retries so the website's
 * {@code apply_network_stat_events} dedup table catches duplicates.
 */
public final class StatEventsRequest {
  public final String serverId;
  public final String batchId;
  public final List<Event> events;

  public StatEventsRequest(String serverId, String batchId, List<Event> events) {
    this.serverId = serverId;
    this.batchId = batchId;
    this.events = events;
  }

  public static final class Event {
    public final String statKey;
    public final String subjectType;
    public final String subjectId;
    public final String displayName;
    public final double value;
    public final String mode;

    public Event(String statKey, String subjectType, String subjectId, String displayName, double value, String mode) {
      this.statKey = statKey;
      this.subjectType = subjectType;
      this.subjectId = subjectId;
      this.displayName = displayName;
      this.value = value;
      this.mode = mode;
    }
  }
}
