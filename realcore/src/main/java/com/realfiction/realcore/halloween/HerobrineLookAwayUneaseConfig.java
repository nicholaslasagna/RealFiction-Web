package com.realfiction.realcore.halloween;

import java.time.Duration;
import org.bukkit.configuration.ConfigurationSection;

public record HerobrineLookAwayUneaseConfig(
    boolean enabled,
    double chance,
    Duration cooldown
) {
  public static HerobrineLookAwayUneaseConfig from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    return new HerobrineLookAwayUneaseConfig(
        section.getBoolean("enabled", true),
        HerobrineStalkerRules.clampChance(section.getDouble("chance", 0.05)),
        Duration.ofSeconds(Math.max(30L, Math.min(600L, section.getLong("cooldownSeconds", 90))))
    );
  }

  public static HerobrineLookAwayUneaseConfig defaults() {
    return new HerobrineLookAwayUneaseConfig(
        true,
        0.05,
        Duration.ofSeconds(90)
    );
  }
}
