package com.realfiction.realcore.config;

import java.time.Duration;
import org.bukkit.configuration.ConfigurationSection;

/**
 * Gameplay economy sync observability and queue safety limits.
 *
 * <p>Defaults are enabled with conservative thresholds and do not enable live writes.
 */
public record GameplayEconomyObservabilityConfig(
    boolean enabled,
    long slowFlushMs,
    long slowHttpMs,
    Duration summaryInterval,
    int maxQueueEntries,
    int maxRetryEntries,
    Duration maxTransactionAge
) {
  public static GameplayEconomyObservabilityConfig defaults() {
    return new GameplayEconomyObservabilityConfig(
        true,
        2000,
        1000,
        Duration.ofSeconds(300),
        5000,
        12,
        Duration.ofSeconds(3600)
    );
  }

  public static GameplayEconomyObservabilityConfig from(ConfigurationSection section) {
    GameplayEconomyObservabilityConfig defaults = defaults();
    if (section == null) {
      return defaults;
    }
    return new GameplayEconomyObservabilityConfig(
        section.getBoolean("enabled", defaults.enabled()),
        Math.max(100, section.getLong("slowFlushMs", defaults.slowFlushMs())),
        Math.max(100, section.getLong("slowHttpMs", defaults.slowHttpMs())),
        Duration.ofSeconds(Math.max(60, section.getLong("summaryIntervalSeconds", defaults.summaryInterval().toSeconds()))),
        Math.max(10, Math.min(50_000, section.getInt("maxQueueEntries", defaults.maxQueueEntries()))),
        Math.max(1, Math.min(100, section.getInt("maxRetryEntries", defaults.maxRetryEntries()))),
        Duration.ofSeconds(Math.max(60, section.getLong("maxTransactionAgeSeconds", defaults.maxTransactionAge().toSeconds())))
    );
  }
}
