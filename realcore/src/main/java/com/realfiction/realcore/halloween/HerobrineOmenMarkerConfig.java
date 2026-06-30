package com.realfiction.realcore.halloween;

import java.time.Duration;
import java.util.Locale;
import org.bukkit.configuration.ConfigurationSection;

public record HerobrineOmenMarkerConfig(
    boolean enabled,
    double chance,
    String type,
    Duration linger,
    boolean particlesOnly
) {
  public static HerobrineOmenMarkerConfig from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    return new HerobrineOmenMarkerConfig(
        section.getBoolean("enabled", true),
        HerobrineStalkerRules.clampChance(section.getDouble("chance", 0.015)),
        cleanType(section.getString("type", "ash_ring")),
        Duration.ofSeconds(Math.max(1L, Math.min(12L, section.getLong("lingerSeconds", 4)))),
        section.getBoolean("particlesOnly", true)
    );
  }

  public static HerobrineOmenMarkerConfig defaults() {
    return new HerobrineOmenMarkerConfig(
        true,
        0.015,
        "ash_ring",
        Duration.ofSeconds(4),
        true
    );
  }

  private static String cleanType(String value) {
    String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    return switch (normalized) {
      case "ash_ring", "smoke_cluster", "redstone_dust", "corrupted_footprints" -> normalized;
      default -> "ash_ring";
    };
  }
}
