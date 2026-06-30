package com.realfiction.realcore.halloween;

import java.time.Duration;
import org.bukkit.configuration.ConfigurationSection;

public record HerobrineMiningIntentConfig(
    boolean enabled,
    double chanceMultiplier,
    double vanishViewDegrees,
    Duration maxLinger
) {
  public static HerobrineMiningIntentConfig from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    return new HerobrineMiningIntentConfig(
        section.getBoolean("enabled", true),
        Math.max(1.0, Math.min(5.0, section.getDouble("chanceMultiplier", 1.5))),
        Math.max(5.0, Math.min(90.0, section.getDouble("vanishViewDegrees", 42.0))),
        Duration.ofSeconds(Math.max(1L, Math.min(30L, section.getLong("maxLingerSeconds", 8))))
    );
  }

  public static HerobrineMiningIntentConfig defaults() {
    return new HerobrineMiningIntentConfig(
        true,
        1.5,
        42.0,
        Duration.ofSeconds(8)
    );
  }
}
