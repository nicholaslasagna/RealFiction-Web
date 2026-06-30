package com.realfiction.realcore.halloween;

import java.time.Duration;
import org.bukkit.configuration.ConfigurationSection;

public record HerobrineLightningOmenConfig(
    boolean enabled,
    double chance,
    int radius,
    Duration minDelay,
    Duration maxDelay,
    boolean damage,
    boolean fire
) {
  public static HerobrineLightningOmenConfig from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    long minDelay = Math.max(1L, section.getLong("minDelaySeconds", 2));
    long maxDelay = Math.max(minDelay, section.getLong("maxDelaySeconds", 6));
    return new HerobrineLightningOmenConfig(
        section.getBoolean("enabled", true),
        clampChance(section.getDouble("chance", 0.03)),
        Math.max(4, Math.min(48, section.getInt("radius", 18))),
        Duration.ofSeconds(minDelay),
        Duration.ofSeconds(maxDelay),
        section.getBoolean("damage", false),
        section.getBoolean("fire", false)
    );
  }

  public static HerobrineLightningOmenConfig defaults() {
    return new HerobrineLightningOmenConfig(
        true,
        0.03,
        18,
        Duration.ofSeconds(2),
        Duration.ofSeconds(6),
        false,
        false
    );
  }

  private static double clampChance(double value) {
    if (Double.isNaN(value) || value < 0.0) {
      return 0.0;
    }
    return Math.min(1.0, value);
  }
}
