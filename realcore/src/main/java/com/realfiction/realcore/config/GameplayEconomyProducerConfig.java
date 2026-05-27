package com.realfiction.realcore.config;

import com.realfiction.realcore.economy.GameplayEconomyCategory;
import java.util.Locale;
import org.bukkit.configuration.ConfigurationSection;

/**
 * Per-producer gameplay economy sync settings.
 *
 * <p>Accepts both credit ({@code gameplay_earn}, {@code shop_sell}) and debit
 * ({@code gameplay_spend}, {@code shop_buy}) categories. Debit producers still go
 * through every guard ({@code GameplayEconomyCaptureService.guardReason}) and a
 * direction-appropriate per-transaction cap before reaching the buffer.
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
      case "gameplay_spend" -> GameplayEconomyCategory.GAMEPLAY_SPEND;
      case "shop_buy" -> GameplayEconomyCategory.SHOP_BUY;
      default -> throw new IllegalArgumentException(
          "economy.gameplaySync.producers category must be one of "
              + "gameplay_earn, shop_sell, gameplay_spend, or shop_buy, not " + value);
    };
  }
}
