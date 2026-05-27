package com.realfiction.realcore.config;

import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;
import org.bukkit.configuration.ConfigurationSection;

/**
 * Disabled-by-default settings for the internal generic gameplay economy producer.
 */
public record GameplayEconomyGenericConfig(
    boolean enabled,
    boolean dryRun,
    Set<String> allowedSources,
    boolean allowGameplayEarn,
    boolean allowGameplaySpend,
    long maxCreditMinorPerEvent,
    long maxDebitMinorPerEvent,
    boolean logEvents
) {
  public static final int DEFAULT_MAX_EVENTS_PER_FLUSH = 250;

  public static GameplayEconomyGenericConfig disabledDefaults() {
    return new GameplayEconomyGenericConfig(
        false,
        true,
        Set.of(),
        false,
        false,
        50_000,
        50_000,
        true
    );
  }

  public static GameplayEconomyGenericConfig from(ConfigurationSection section) {
    GameplayEconomyGenericConfig defaults = disabledDefaults();
    if (section == null) {
      return defaults;
    }
    return new GameplayEconomyGenericConfig(
        section.getBoolean("enabled", defaults.enabled()),
        section.getBoolean("dryRun", defaults.dryRun()),
        normalizeSources(section.getStringList("allowedSources")),
        section.getBoolean("allowGameplayEarn", defaults.allowGameplayEarn()),
        section.getBoolean("allowGameplaySpend", defaults.allowGameplaySpend()),
        cap(section.getLong("maxCreditMinorPerEvent", defaults.maxCreditMinorPerEvent())),
        cap(section.getLong("maxDebitMinorPerEvent", defaults.maxDebitMinorPerEvent())),
        section.getBoolean("logEvents", defaults.logEvents())
    );
  }

  public boolean sourceAllowlisted(String source) {
    if (source == null || source.isBlank() || allowedSources.isEmpty()) {
      return false;
    }
    return allowedSources.contains(source.trim().toLowerCase(Locale.ROOT));
  }

  private static long cap(long value) {
    return Math.max(1, Math.min(1_000_000_000_000L, value));
  }

  private static Set<String> normalizeSources(List<String> configured) {
    if (configured == null || configured.isEmpty()) {
      return Set.of();
    }
    return configured.stream()
        .map(value -> value == null ? "" : value.trim().toLowerCase(Locale.ROOT))
        .filter(value -> !value.isBlank())
        .collect(Collectors.toUnmodifiableSet());
  }
}
