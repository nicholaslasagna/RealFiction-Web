package com.realfiction.realcore.halloween;

import java.time.LocalDate;
import org.bukkit.configuration.ConfigurationSection;

public record HalloweenConfig(
    boolean enabled,
    HerobrineStalkerConfig herobrineStalker
) {
  public static HalloweenConfig from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    return new HalloweenConfig(
        section.getBoolean("enabled", true),
        HerobrineStalkerConfig.from(section.getConfigurationSection("herobrineStalker"))
    );
  }

  public static HalloweenConfig defaults() {
    return new HalloweenConfig(true, HerobrineStalkerConfig.defaults());
  }

  public boolean stalkerCalendarActive(LocalDate date) {
    return enabled && herobrineStalker.enabled() && herobrineStalker.dateWindow().contains(date);
  }

  public boolean stalkerAllowedOn(String serverId, String serverGroup, String worldName) {
    return enabled
        && herobrineStalker.enabled()
        && herobrineStalker.serverAllowed(serverId, serverGroup)
        && herobrineStalker.worldAllowed(worldName);
  }
}
