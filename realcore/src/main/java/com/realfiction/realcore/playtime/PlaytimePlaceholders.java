package com.realfiction.realcore.playtime;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.api.dto.PlaytimeLeaderboardResponse;
import com.realfiction.realcore.api.dto.StatLeaderboardResponse;
import com.realfiction.realcore.stats.NetworkStatService;
import com.realfiction.realcore.stats.StatPlaceholders;
import java.util.List;
import java.util.Locale;
import me.clip.placeholderapi.expansion.PlaceholderExpansion;
import org.bukkit.OfflinePlayer;

/**
 * PlaceholderAPI expansion exposing network playtime. Only loaded when
 * PlaceholderAPI is installed (instantiated behind a presence check), so servers
 * without it never touch these classes.
 *
 * <p>Placeholders:
 * <ul>
 *   <li>{@code %realcore_playtime_total_top_<n>_name%} / {@code _time} / {@code _seconds}</li>
 *   <li>{@code %realcore_playtime_<group>_top_<n>_name%} (lobby/smp/factions/anarchy/arcade)</li>
 *   <li>{@code %realcore_playtime_player_total%}</li>
 *   <li>{@code %realcore_stat_<key>_top_<n>_name|value|time|seconds|uuid%} — for keys
 *       starting with {@code playtime.}, {@code _time} / {@code _seconds} format seconds;
 *       {@code _value} stays raw. Uses {@link com.realfiction.realcore.stats.NetworkStatService}
 *       (not the legacy playtime leaderboard cache; see that class for dual-cache notes).</li>
 * </ul>
 */
public final class PlaytimePlaceholders extends PlaceholderExpansion {
  private final RealCorePlugin plugin;
  private final String version;

  public PlaytimePlaceholders(RealCorePlugin plugin, String version) {
    this.plugin = plugin;
    this.version = version;
  }

  @Override
  public String getIdentifier() {
    return "realcore";
  }

  @Override
  public String getAuthor() {
    return "RealFiction";
  }

  @Override
  public String getVersion() {
    return version;
  }

  @Override
  public boolean persist() {
    return true;
  }

  @Override
  public String onRequest(OfflinePlayer player, String params) {
    String raw = params == null ? "" : params.toLowerCase(Locale.ROOT);

    // Generic, reusable stat placeholders: stat_<key>_top_<n>_<name|value|uuid>.
    if (raw.startsWith("stat_")) {
      return statPlaceholder(raw.substring("stat_".length()));
    }

    // Backwards-compatible playtime placeholders below.
    PlaytimeTracker tracker = plugin.playtimeTracker();
    if (!raw.startsWith("playtime_")) {
      return null;
    }
    String key = raw.substring("playtime_".length());

    if (key.equals("player_total")) {
      if (tracker == null || player == null) {
        return "0m";
      }
      return PlaytimeFormat.human(tracker.playerTotalSeconds(player.getUniqueId()));
    }

    int topIdx = key.indexOf("_top_");
    if (topIdx > 0) {
      String group = key.substring(0, topIdx);
      if (group.equals("total")) {
        group = "all";
      }
      String rest = key.substring(topIdx + "_top_".length());
      int underscore = rest.lastIndexOf('_');
      if (underscore <= 0) {
        return null;
      }
      String field = rest.substring(underscore + 1);
      int rank;
      try {
        rank = Integer.parseInt(rest.substring(0, underscore));
      } catch (NumberFormatException ignored) {
        return null;
      }

      List<PlaytimeLeaderboardResponse.Entry> board = tracker == null ? List.of() : tracker.topPlaytime(group);
      if (rank < 1 || rank > board.size()) {
        return field.equals("name") ? "" : "0m";
      }
      PlaytimeLeaderboardResponse.Entry entry = board.get(rank - 1);
      return switch (field) {
        case "name" -> entry.username != null ? entry.username : "?";
        case "time" -> PlaytimeFormat.human(entry.seconds);
        case "seconds" -> Long.toString(entry.seconds);
        default -> null;
      };
    }
    return null;
  }

  private String statPlaceholder(String afterStat) {
    StatPlaceholders.TopRequest top = StatPlaceholders.parseTop(afterStat);
    if (top == null) {
      return null;
    }
    NetworkStatService stats = plugin.networkStatService();
    List<StatLeaderboardResponse.Entry> board = stats == null ? List.of() : stats.top(top.statKey());
    boolean playtime = StatPlaceholders.isPlaytimeStatKey(top.statKey());
    if (top.rank() < 1 || top.rank() > board.size()) {
      return switch (top.field()) {
        case "name" -> "";
        case "time" -> playtime ? "0m" : "0";
        default -> "0";
      };
    }
    StatLeaderboardResponse.Entry entry = board.get(top.rank() - 1);
    long seconds = (long) entry.value;
    return switch (top.field()) {
      case "name" -> entry.displayName != null ? entry.displayName : "?";
      case "value" -> StatPlaceholders.formatValue(entry.value);
      case "time" -> playtime ? PlaytimeFormat.human(seconds) : StatPlaceholders.formatValue(entry.value);
      case "seconds" -> playtime ? Long.toString(seconds) : StatPlaceholders.formatValue(entry.value);
      case "uuid" -> entry.subjectId != null ? entry.subjectId : "";
      default -> null;
    };
  }
}
