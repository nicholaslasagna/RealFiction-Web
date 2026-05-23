package com.realfiction.realcore.config;

import java.time.Duration;
import java.util.List;
import org.bukkit.configuration.ConfigurationSection;

/** Which stat leaderboards RealCore caches for placeholders/holograms. */
public record StatsConfig(
    boolean enabled,
    Duration refreshInterval,
    int leaderboardSize,
    List<String> leaderboardKeys
) {
  public static StatsConfig defaults() {
    return new StatsConfig(true, Duration.ofSeconds(120), 10, defaultKeys());
  }

  public static StatsConfig from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    boolean enabled = section.getBoolean("enabled", true);
    long refresh = Math.max(30, section.getLong("refreshSeconds", 120));
    int size = Math.max(1, Math.min(100, section.getInt("leaderboardSize", 10)));
    List<String> keys = section.getStringList("leaderboards");
    if (keys.isEmpty()) {
      keys = defaultKeys();
    }
    return new StatsConfig(enabled, Duration.ofSeconds(refresh), size, List.copyOf(keys));
  }

  private static List<String> defaultKeys() {
    return List.of(
        "playtime.total",
        "playtime.lobby",
        "playtime.smp",
        "playtime.factions",
        "playtime.anarchy",
        "playtime.arcade"
    );
  }
}
