package com.realfiction.realcore.halloween;

import java.time.Duration;
import org.bukkit.configuration.ConfigurationSection;

public record HerobrineDistantSilhouetteConfig(
    boolean enabled,
    double chance,
    Duration minLinger,
    Duration maxLinger
) {
  public static HerobrineDistantSilhouetteConfig from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    long min = Math.max(1L, Math.min(5L, section.getLong("minLingerSeconds", 1)));
    long max = Math.max(min, Math.min(6L, section.getLong("maxLingerSeconds", 2)));
    return new HerobrineDistantSilhouetteConfig(
        section.getBoolean("enabled", true),
        HerobrineStalkerRules.clampChance(section.getDouble("chance", 0.10)),
        Duration.ofSeconds(min),
        Duration.ofSeconds(max)
    );
  }

  public static HerobrineDistantSilhouetteConfig defaults() {
    return new HerobrineDistantSilhouetteConfig(
        true,
        0.10,
        Duration.ofSeconds(1),
        Duration.ofSeconds(2)
    );
  }
}
