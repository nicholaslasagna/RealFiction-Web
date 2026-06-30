package com.realfiction.realcore.halloween;

import org.bukkit.configuration.ConfigurationSection;

public record HerobrineVanishOnLookConfig(
    boolean enabled,
    double normalViewDegrees,
    double miningIntentViewDegrees,
    boolean requireLineOfSight,
    long checkIntervalTicks
) {
  public static HerobrineVanishOnLookConfig from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    return new HerobrineVanishOnLookConfig(
        section.getBoolean("enabled", true),
        clampDegrees(section.getDouble("normalViewDegrees", 32.0)),
        clampDegrees(section.getDouble("miningIntentViewDegrees", 52.0)),
        section.getBoolean("requireLineOfSight", true),
        Math.max(2L, Math.min(40L, section.getLong("checkIntervalTicks", 5L)))
    );
  }

  public static HerobrineVanishOnLookConfig defaults() {
    return new HerobrineVanishOnLookConfig(
        true,
        32.0,
        52.0,
        true,
        5L
    );
  }

  private static double clampDegrees(double value) {
    if (Double.isNaN(value)) {
      return 32.0;
    }
    return Math.max(5.0, Math.min(90.0, value));
  }
}
