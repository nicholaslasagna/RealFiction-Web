package com.realfiction.realcore.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class EconomyConfigTest {
  @Test
  void defaultsAreDisabled() {
    EconomyConfig config = EconomyConfig.from(null);

    assertFalse(config.enabled());
    assertEquals("realfiction_main", config.currencyKey());
    assertEquals(30, config.flushInterval().toSeconds());
    assertEquals(5000, config.bufferSize());
    assertEquals(100, config.maxBatchSize());
  }

  @Test
  void parsesConfiguredValuesAndClampsBounds() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        economy:
          enabled: true
          currencyKey: "RealFiction_Main"
          flushSeconds: 1
          bufferSize: 0
          maxBatchSize: 900
          balanceCacheSeconds: 2
        """);

    EconomyConfig config = EconomyConfig.from(yaml.getConfigurationSection("economy"));

    assertTrue(config.enabled());
    assertEquals("realfiction_main", config.currencyKey());
    assertEquals(5, config.flushInterval().toSeconds());
    assertEquals(1, config.bufferSize());
    assertEquals(500, config.maxBatchSize());
    assertEquals(5, config.balanceCacheTtl().toSeconds());
  }

  @Test
  void rejectsInvalidCurrencyKey() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        economy:
          currencyKey: "bad key!"
        """);

    assertThrows(IllegalArgumentException.class, () -> EconomyConfig.from(yaml.getConfigurationSection("economy")));
  }
}
