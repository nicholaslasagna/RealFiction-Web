package com.realfiction.realcore.stats;

/**
 * Parsing helpers for generic stat placeholders of the form
 * {@code stat_<key>_top_<rank>_<field>} (e.g. {@code stat_playtime.total_top_1_name}).
 * Kept free of Bukkit/PAPI types so it is unit-testable.
 */
public final class StatPlaceholders {
  private StatPlaceholders() {
  }

  public record TopRequest(String statKey, int rank, String field) {
  }

  /** Parses the part after {@code stat_}; returns null if it is not a top-N request. */
  public static TopRequest parseTop(String afterStat) {
    if (afterStat == null) {
      return null;
    }
    int topIdx = afterStat.indexOf("_top_");
    if (topIdx <= 0) {
      return null;
    }
    String statKey = afterStat.substring(0, topIdx);
    String rest = afterStat.substring(topIdx + "_top_".length());
    int underscore = rest.lastIndexOf('_');
    if (underscore <= 0) {
      return null;
    }
    String field = rest.substring(underscore + 1);
    if (statKey.isBlank() || field.isBlank()) {
      return null;
    }
    int rank;
    try {
      rank = Integer.parseInt(rest.substring(0, underscore));
    } catch (NumberFormatException ignored) {
      return null;
    }
    if (rank < 1) {
      return null;
    }
    return new TopRequest(statKey, rank, field);
  }

  public static boolean isPlaytimeStatKey(String statKey) {
    return statKey != null && statKey.startsWith("playtime.");
  }

  /** Prints an integral value without a trailing ".0", otherwise the decimal. */
  public static String formatValue(double value) {
    if (!Double.isFinite(value)) {
      return "0";
    }
    if (value == Math.rint(value)) {
      return Long.toString((long) value);
    }
    return Double.toString(value);
  }
}
