package com.realfiction.realcore.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.economy.GameplayEconomyCategory;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class GameplayEconomyProducersConfigTest {
  @Test
  void buyProducerDisabledByDefault() {
    GameplayEconomyProducersConfig config = GameplayEconomyProducersConfig.disabledDefaults();

    assertFalse(config.economyShopGuiBuy().enabled());
    assertTrue(config.economyShopGuiBuy().dryRun());
    assertEquals(GameplayEconomyCategory.SHOP_BUY, config.economyShopGuiBuy().category());
    assertEquals(250, config.economyShopGuiBuy().maxEventsPerFlush());
  }

  @Test
  void parsesBuyProducerBlock() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        producers:
          economyShopGuiBuy:
            enabled: true
            category: shop_buy
            dryRun: true
            logEvents: false
            maxEventsPerFlush: 100
        dedupCacheSeconds: 120
        dedupCacheMaxEntries: 500
        """);

    GameplayEconomyProducersConfig config = GameplayEconomyProducersConfig.from(yaml);

    assertTrue(config.economyShopGuiBuy().enabled());
    assertEquals(GameplayEconomyCategory.SHOP_BUY, config.economyShopGuiBuy().category());
    assertTrue(config.economyShopGuiBuy().dryRun());
    assertFalse(config.economyShopGuiBuy().logEvents());
    assertEquals(100, config.economyShopGuiBuy().maxEventsPerFlush());
    assertEquals(120, config.dedupCacheTtl().toSeconds());
    assertEquals(500, config.dedupCacheMaxEntries());
  }
}
