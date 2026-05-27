package com.realfiction.realcore.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class GameplayEconomyGenericConfigTest {
  @Test
  void disabledDefaults() {
    GameplayEconomyGenericConfig config = GameplayEconomyGenericConfig.disabledDefaults();
    assertFalse(config.enabled());
    assertTrue(config.dryRun());
    assertTrue(config.allowedSources().isEmpty());
    assertFalse(config.allowGameplayEarn());
    assertFalse(config.allowGameplaySpend());
    assertEquals(50_000, config.maxCreditMinorPerEvent());
    assertEquals(50_000, config.maxDebitMinorPerEvent());
  }

  @Test
  void sourceAllowlistIsCaseInsensitive() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        enabled: true
        allowedSources:
          - RealCoreQuests
        """);
    GameplayEconomyGenericConfig config = GameplayEconomyGenericConfig.from(yaml);
    assertTrue(config.sourceAllowlisted("realcorequests"));
    assertFalse(config.sourceAllowlisted("Other"));
  }
}
