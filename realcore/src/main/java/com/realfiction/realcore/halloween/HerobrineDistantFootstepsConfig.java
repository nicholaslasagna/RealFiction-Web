package com.realfiction.realcore.halloween;

import java.time.Duration;
import org.bukkit.configuration.ConfigurationSection;

public record HerobrineDistantFootstepsConfig(
    boolean enabled,
    double chance,
    int minDistance,
    int maxDistance,
    Duration cooldown
) {
  public static HerobrineDistantFootstepsConfig from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    int minDistance = Math.max(3, Math.min(32, section.getInt("minDistance", 6)));
    int maxDistance = Math.max(minDistance, Math.min(48, section.getInt("maxDistance", 14)));
    return new HerobrineDistantFootstepsConfig(
        section.getBoolean("enabled", true),
        HerobrineStalkerRules.clampChance(section.getDouble("chance", 0.06)),
        minDistance,
        maxDistance,
        Duration.ofSeconds(Math.max(10L, Math.min(300L, section.getLong("cooldownSeconds", 45))))
    );
  }

  public static HerobrineDistantFootstepsConfig defaults() {
    return new HerobrineDistantFootstepsConfig(
        true,
        0.06,
        6,
        14,
        Duration.ofSeconds(45)
    );
  }
}
