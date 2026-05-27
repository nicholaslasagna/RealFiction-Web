package com.realfiction.realcore.config;

import com.realfiction.realcore.economy.GameplayEconomyCategory;
import java.time.Duration;
import org.bukkit.configuration.ConfigurationSection;

public record GameplayEconomyProducersConfig(
    GameplayEconomyProducerConfig economyShopGuiSell,
    Duration dedupCacheTtl,
    int dedupCacheMaxEntries
) {
  public static GameplayEconomyProducersConfig disabledDefaults() {
    return new GameplayEconomyProducersConfig(
        GameplayEconomyProducerConfig.disabledDefaults(GameplayEconomyCategory.SHOP_SELL),
        Duration.ofMinutes(5),
        10_000
    );
  }

  public static GameplayEconomyProducersConfig from(ConfigurationSection section) {
    GameplayEconomyProducersConfig defaults = disabledDefaults();
    if (section == null) {
      return defaults;
    }
    ConfigurationSection producers = section.getConfigurationSection("producers");
    ConfigurationSection economyShopGuiSell = producers == null ? null : producers.getConfigurationSection("economyShopGuiSell");
    return new GameplayEconomyProducersConfig(
        GameplayEconomyProducerConfig.from(economyShopGuiSell, GameplayEconomyCategory.SHOP_SELL),
        Duration.ofSeconds(Math.max(30, section.getLong("dedupCacheSeconds", defaults.dedupCacheTtl().toSeconds()))),
        Math.max(100, Math.min(100_000, section.getInt("dedupCacheMaxEntries", defaults.dedupCacheMaxEntries())))
    );
  }
}
