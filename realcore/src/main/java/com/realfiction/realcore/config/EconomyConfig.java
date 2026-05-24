package com.realfiction.realcore.config;

import java.time.Duration;
import org.bukkit.configuration.ConfigurationSection;

/**
 * Disabled-by-default global economy client settings.
 *
 * <p>Phase 3 only prepares the RealCore HTTP client/queue foundation. It does
 * not register a Vault provider, mutate EssentialsX balances, or create any
 * gameplay producers.
 */
public record EconomyConfig(
    boolean enabled,
    String currencyKey,
    Duration flushInterval,
    int bufferSize,
    int maxBatchSize,
    Duration balanceCacheTtl,
    long stagingTestMaxCreditMinor
) {
  public static EconomyConfig disabledDefaults() {
    return new EconomyConfig(
        false,
        "realfiction_main",
        Duration.ofSeconds(30),
        5000,
        100,
        Duration.ofSeconds(30),
        100
    );
  }

  public static EconomyConfig from(ConfigurationSection section) {
    EconomyConfig defaults = disabledDefaults();
    if (section == null) {
      return defaults;
    }

    String currencyKey = section.getString("currencyKey", defaults.currencyKey()).trim().toLowerCase(java.util.Locale.ROOT);
    if (!currencyKey.matches("^[a-z0-9_.-]{2,80}$")) {
      throw new IllegalArgumentException("economy.currencyKey must be 2-80 letters, numbers, dots, dashes, or underscores.");
    }

    return new EconomyConfig(
        section.getBoolean("enabled", defaults.enabled()),
        currencyKey,
        Duration.ofSeconds(Math.max(5, section.getLong("flushSeconds", defaults.flushInterval().toSeconds()))),
        Math.max(1, section.getInt("bufferSize", defaults.bufferSize())),
        Math.max(1, Math.min(500, section.getInt("maxBatchSize", defaults.maxBatchSize()))),
        Duration.ofSeconds(Math.max(5, section.getLong("balanceCacheSeconds", defaults.balanceCacheTtl().toSeconds()))),
        Math.max(1, Math.min(10_000, section.getLong("stagingTestMaxCreditMinor", defaults.stagingTestMaxCreditMinor())))
    );
  }
}
