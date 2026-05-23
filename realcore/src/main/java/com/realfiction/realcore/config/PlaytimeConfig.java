package com.realfiction.realcore.config;

import java.time.Duration;
import java.util.List;
import org.bukkit.configuration.ConfigurationSection;

/** Settings for the network playtime tracker (separate from the HMAC config). */
public record PlaytimeConfig(
    Duration flushInterval,
    Duration leaderboardRefresh,
    int leaderboardSize,
    List<String> leaderboardGroups
) {
  public static PlaytimeConfig defaults() {
    return new PlaytimeConfig(Duration.ofSeconds(60), Duration.ofSeconds(300), 10, defaultGroups());
  }

  public static PlaytimeConfig from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    long flush = Math.max(15, section.getLong("flushIntervalSeconds", 60));
    long leaderboard = Math.max(30, section.getLong("leaderboardRefreshSeconds", 300));
    int size = Math.max(1, Math.min(100, section.getInt("leaderboardSize", 10)));
    List<String> groups = section.getStringList("leaderboardGroups");
    if (groups.isEmpty()) {
      groups = defaultGroups();
    }
    return new PlaytimeConfig(
        Duration.ofSeconds(flush),
        Duration.ofSeconds(leaderboard),
        size,
        List.copyOf(groups)
    );
  }

  private static List<String> defaultGroups() {
    return List.of("all", "lobby", "smp", "factions", "anarchy", "arcade");
  }
}
