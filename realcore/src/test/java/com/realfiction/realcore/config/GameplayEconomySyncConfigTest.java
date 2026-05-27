package com.realfiction.realcore.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class GameplayEconomySyncConfigTest {
  @Test
  void defaultsAreDisabledWithDryRun() {
    GameplayEconomySyncConfig config = GameplayEconomySyncConfig.from(null);

    assertFalse(config.enabled());
    assertEquals(List.of("smp-1"), config.backendAllowlist());
    assertFalse(config.gameplayEarn());
    assertFalse(config.gameplaySpend());
    assertFalse(config.shopSell());
    assertFalse(config.shopBuy());
    assertEquals(50_000, config.maxCreditMinorPerTx());
    assertEquals(50_000, config.maxDebitMinorPerTx());
    assertTrue(config.dryRun());
    assertTrue(config.logTransactions());
  }

  @Test
  void parsesNestedCategories() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        gameplaySync:
          enabled: true
          backendAllowlist:
            - SMP-1
          categories:
            gameplayEarn: true
            shopBuy: true
          dryRun: false
          maxCreditMinorPerTx: 999
        """);

    GameplayEconomySyncConfig config = GameplayEconomySyncConfig.from(yaml.getConfigurationSection("gameplaySync"));

    assertTrue(config.enabled());
    assertEquals(List.of("smp-1"), config.backendAllowlist());
    assertTrue(config.gameplayEarn());
    assertFalse(config.gameplaySpend());
    assertFalse(config.shopSell());
    assertTrue(config.shopBuy());
    assertFalse(config.dryRun());
    assertEquals(999, config.maxCreditMinorPerTx());
  }
}
