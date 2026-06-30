package com.realfiction.realcore.halloween;

import java.time.Duration;
import org.bukkit.configuration.ConfigurationSection;

public record HerobrineMiningFakeoutConfig(
    boolean enabled,
    double chance,
    int radius,
    Duration cooldown
) {
  public static HerobrineMiningFakeoutConfig from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    return new HerobrineMiningFakeoutConfig(
        section.getBoolean("enabled", true),
        HerobrineStalkerRules.clampChance(section.getDouble("chance", 0.04)),
        Math.max(4, Math.min(48, section.getInt("radius", 16))),
        Duration.ofSeconds(Math.max(10L, Math.min(300L, section.getLong("cooldownSeconds", 60))))
    );
  }

  public static HerobrineMiningFakeoutConfig defaults() {
    return new HerobrineMiningFakeoutConfig(
        true,
        0.04,
        16,
        Duration.ofSeconds(60)
    );
  }
}
