package com.realfiction.realcore.halloween;

import java.time.Duration;
import org.bukkit.configuration.ConfigurationSection;

public record HerobrineWindowStalkConfig(
    boolean enabled,
    double chance,
    boolean requireDarkOutside,
    boolean requireRainOrSnow,
    boolean requireGlassLineOfSight,
    int minOutsideDistance,
    int maxOutsideDistance,
    Duration maxLinger,
    boolean vanishOnSeen,
    int avoidPlayerBaseBlocksRadius,
    int minHeadroom,
    int maxCandidateChecks
) {
  public static HerobrineWindowStalkConfig from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    int minDistance = Math.max(3, Math.min(32, section.getInt("minOutsideDistance", 8)));
    int maxDistance = Math.max(minDistance, Math.min(48, section.getInt("maxOutsideDistance", 24)));
    return new HerobrineWindowStalkConfig(
        section.getBoolean("enabled", true),
        HerobrineStalkerRules.clampChance(section.getDouble("chance", 0.02)),
        section.getBoolean("requireDarkOutside", true),
        section.getBoolean("requireRainOrSnow", true),
        section.getBoolean("requireGlassLineOfSight", true),
        minDistance,
        maxDistance,
        Duration.ofSeconds(Math.max(1L, Math.min(15L, section.getLong("maxLingerSeconds", 8)))),
        section.getBoolean("vanishOnSeen", true),
        Math.max(0, Math.min(16, section.getInt("avoidPlayerBaseBlocksRadius", 6))),
        Math.max(2, Math.min(5, section.getInt("minHeadroom", 2))),
        Math.max(1, Math.min(64, section.getInt("maxCandidateChecks", 48)))
    );
  }

  public static HerobrineWindowStalkConfig defaults() {
    return new HerobrineWindowStalkConfig(
        true,
        0.02,
        true,
        true,
        true,
        8,
        24,
        Duration.ofSeconds(8),
        true,
        6,
        2,
        48
    );
  }
}
