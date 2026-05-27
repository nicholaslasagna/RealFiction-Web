package com.realfiction.realcore.config;

import com.realfiction.realcore.economy.GameplayEconomyCategory;
import java.util.Locale;
import org.bukkit.configuration.ConfigurationSection;

/**
 * Per-producer gameplay economy sync settings.
 *
 * <p>Only credit categories ({@code gameplay_earn}, {@code shop_sell}) are allowed in Phase 9.
 */
public record GameplayEconomyProducerConfig(
    boolean enabled,
    GameplayEconomyCategory category,
    boolean dryRun,
    boolean logEvents,
    int maxEventsPerFlush
) {
  public static GameplayEconomyProducerConfig disabledDefaults(GameplayEconomyCategory category) {
    return new GameplayEconomyProducerConfig(false, category, true, true, 250);
  }

  public static GameplayEconomyProducerConfig from(ConfigurationSection section, GameplayEconomyCategory fallbackCategory) {
    GameplayEconomyProducerConfig defaults = disabledDefaults(fallbackCategory);
    if (section == null) {
      return defaults;
    }
    GameplayEconomyCategory category = parseCategory(section.getString("category"), defaults.category());
    return new GameplayEconomyProducerConfig(
        section.getBoolean("enabled", defaults.enabled()),
        category,
        section.getBoolean("dryRun", defaults.dryRun()),
        section.getBoolean("logEvents", defaults.logEvents()),
        Math.max(1, Math.min(10_000, section.getInt("maxEventsPerFlush", defaults.maxEventsPerFlush())))
    );
  }

  public static GameplayEconomyCategory parseCategory(String value, GameplayEconomyCategory fallback) {
    if (value == null || value.isBlank()) {
      return fallback;
    }
    String normalized = value.trim().toLowerCase(Locale.ROOT);
    return switch (normalized) {
      case "gameplay_earn" -> GameplayEconomyCategory.GAMEPLAY_EARN;
      case "shop_sell" -> GameplayEconomyCategory.SHOP_SELL;
      default -> throw new IllegalArgumentException(
          "economy.gameplaySync.producers category must be gameplay_earn or shop_sell, not " + value);
    };
  }
}
