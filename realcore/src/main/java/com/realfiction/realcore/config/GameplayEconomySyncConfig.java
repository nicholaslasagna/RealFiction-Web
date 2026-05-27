package com.realfiction.realcore.config;

import java.time.Duration;
import java.util.List;
import org.bukkit.configuration.ConfigurationSection;

/**
 * Disabled-by-default gameplay economy sync buffer settings.
 *
 * <p>Phase 8 only prepares validation and enqueue plumbing. No gameplay producers
 * are wired in this phase.
 */
public record GameplayEconomySyncConfig(
    boolean enabled,
    List<String> backendAllowlist,
    boolean gameplayEarn,
    boolean gameplaySpend,
    boolean shopSell,
    boolean shopBuy,
    Duration flushInterval,
    int maxBatchSize,
    int bufferSize,
    long maxCreditMinorPerTx,
    long maxDebitMinorPerTx,
    boolean dryRun,
    boolean logTransactions
) {
  public static GameplayEconomySyncConfig disabledDefaults() {
    return new GameplayEconomySyncConfig(
        false,
        List.of("smp-1"),
        false,
        false,
        false,
        false,
        Duration.ofSeconds(30),
        50,
        5000,
        50_000,
        50_000,
        true,
        true
    );
  }

  public static GameplayEconomySyncConfig from(ConfigurationSection section) {
    GameplayEconomySyncConfig defaults = disabledDefaults();
    if (section == null) {
      return defaults;
    }

    ConfigurationSection categories = section.getConfigurationSection("categories");

    return new GameplayEconomySyncConfig(
        section.getBoolean("enabled", defaults.enabled()),
        normalizeAllowlist(section.getStringList("backendAllowlist"), defaults.backendAllowlist()),
        bool(categories, section, "gameplayEarn", defaults.gameplayEarn()),
        bool(categories, section, "gameplaySpend", defaults.gameplaySpend()),
        bool(categories, section, "shopSell", defaults.shopSell()),
        bool(categories, section, "shopBuy", defaults.shopBuy()),
        Duration.ofSeconds(Math.max(5, section.getLong("flushSeconds", defaults.flushInterval().toSeconds()))),
        Math.max(1, Math.min(500, section.getInt("maxBatchSize", defaults.maxBatchSize()))),
        Math.max(1, section.getInt("bufferSize", defaults.bufferSize())),
        Math.max(1, Math.min(1_000_000_000_000L, section.getLong("maxCreditMinorPerTx", defaults.maxCreditMinorPerTx()))),
        Math.max(1, Math.min(1_000_000_000_000L, section.getLong("maxDebitMinorPerTx", defaults.maxDebitMinorPerTx()))),
        section.getBoolean("dryRun", defaults.dryRun()),
        section.getBoolean("logTransactions", defaults.logTransactions())
    );
  }

  public boolean categoryEnabled(com.realfiction.realcore.economy.GameplayEconomyCategory category) {
    return switch (category) {
      case GAMEPLAY_EARN -> gameplayEarn();
      case GAMEPLAY_SPEND -> gameplaySpend();
      case SHOP_SELL -> shopSell();
      case SHOP_BUY -> shopBuy();
    };
  }

  private static boolean bool(ConfigurationSection categories, ConfigurationSection section, String key, boolean fallback) {
    if (categories != null) {
      return categories.getBoolean(key, fallback);
    }
    return section.getBoolean(key, fallback);
  }

  private static List<String> normalizeAllowlist(List<String> configured, List<String> fallback) {
    List<String> values = configured == null || configured.isEmpty() ? fallback : configured;
    return values.stream()
        .map(value -> value == null ? "" : value.trim().toLowerCase(java.util.Locale.ROOT))
        .filter(value -> !value.isBlank())
        .distinct()
        .toList();
  }
}
