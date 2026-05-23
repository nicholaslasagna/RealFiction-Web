package com.realfiction.realcore.playtime;

/** Formats a playtime duration in seconds as a compact human string (e.g. "3d 4h 12m"). */
public final class PlaytimeFormat {
  private PlaytimeFormat() {
  }

  public static String human(long seconds) {
    if (seconds <= 0) {
      return "0m";
    }
    long days = seconds / 86400;
    long hours = (seconds % 86400) / 3600;
    long minutes = (seconds % 3600) / 60;

    StringBuilder out = new StringBuilder();
    if (days > 0) {
      out.append(days).append("d ");
    }
    if (hours > 0) {
      out.append(hours).append("h ");
    }
    if (minutes > 0 || out.length() == 0) {
      out.append(minutes).append("m");
    }
    return out.toString().trim();
  }
}
