package com.realfiction.realcore.api.dto;

import java.util.List;

public final class StatLeaderboardResponse {
  public String statKey;
  public String subjectType;
  public List<Entry> entries;

  public static final class Entry {
    public int position;
    public String subjectId;
    public String displayName;
    public double value;
  }
}
