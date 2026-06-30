package com.realfiction.realcore.halloween;

import java.time.Duration;
import java.util.Locale;
import org.bukkit.configuration.ConfigurationSection;

public record HerobrineProximityEffectConfig(
    boolean enabled,
    double radius,
    Duration required,
    String effect,
    Duration duration,
    int amplifier,
    Duration cooldown,
    boolean vanishAfterApply
) {
  public static HerobrineProximityEffectConfig from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    return new HerobrineProximityEffectConfig(
        section.getBoolean("enabled", true),
        clamp(section.getDouble("radius", 4.0), 1.0, 16.0),
        Duration.ofMillis((long) (clamp(section.getDouble("requiredSeconds", 1.0), 0.25, 10.0) * 1000.0)),
        normalizeEffect(section.getString("effect", "DARKNESS")),
        Duration.ofSeconds(Math.max(1L, Math.min(30L, section.getLong("durationSeconds", 10L)))),
        Math.max(0, Math.min(4, section.getInt("amplifier", 0))),
        Duration.ofSeconds(Math.max(5L, Math.min(3600L, section.getLong("cooldownSeconds", 120L)))),
        section.getBoolean("vanishAfterApply", true)
    );
  }

  public static HerobrineProximityEffectConfig defaults() {
    return new HerobrineProximityEffectConfig(
        true,
        4.0,
        Duration.ofSeconds(1),
        "DARKNESS",
        Duration.ofSeconds(10),
        0,
        Duration.ofSeconds(120),
        true
    );
  }

  private static double clamp(double value, double min, double max) {
    if (Double.isNaN(value)) {
      return min;
    }
    return Math.max(min, Math.min(max, value));
  }

  private static String normalizeEffect(String value) {
    String normalized = value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
    return normalized.isBlank() ? "DARKNESS" : normalized;
  }
}
