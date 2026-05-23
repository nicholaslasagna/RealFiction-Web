package com.realfiction.realcore.api.dto;

import java.util.List;

public final class PlaytimeLeaderboardResponse {
  public String group;
  public List<Entry> entries;

  public static final class Entry {
    public int rank;
    public String uuid;
    public String username;
    public long seconds;
  }
}
