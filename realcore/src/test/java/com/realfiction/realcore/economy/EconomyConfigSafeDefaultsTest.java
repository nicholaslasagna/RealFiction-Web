package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.config.RealCoreConfig;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class EconomyConfigSafeDefaultsTest {

  @Test
  void legacyConfigMissingGameplayKeysUsesSafeDefaults() throws InvalidConfigurationException {
    RealCoreConfig config = load("""
        server:
          id: smp-1
          group: smp
        modules:
          economy: false
        economy:
          enabled: false
        """);
    assertFalse(config.modules().economy());
    assertFalse(config.economy().enabled());
    assertFalse(config.economy().gameplaySync().enabled());
    assertTrue(config.economy().gameplaySync().dryRun());
    assertFalse(config.economy().gameplaySync().shopSell());
    assertFalse(config.economy().gameplaySync().shopBuy());
    assertFalse(config.economy().gameplaySync().producers().economyShopGuiSell().enabled());
    assertFalse(config.economy().gameplaySync().producers().economyShopGuiBuy().enabled());
    assertFalse(config.economy().gameplaySync().generic().enabled());
    assertTrue(config.economy().gameplaySync().generic().dryRun());
    assertFalse(config.economy().voteRewardsLedgerWritesEnabled());
  }

  @Test
  void partialGameplaySyncSectionStillSafe() throws InvalidConfigurationException {
    RealCoreConfig config = load("""
        server:
          id: smp-1
        modules:
          economy: true
        economy:
          enabled: true
          gameplaySync:
            enabled: true
        """);
    assertTrue(config.economy().gameplaySync().dryRun());
    assertFalse(config.economy().gameplaySync().producers().economyShopGuiBuy().enabled());
    assertFalse(config.economy().gameplaySync().generic().enabled());
  }

  private static RealCoreConfig load(String yaml) throws InvalidConfigurationException {
    YamlConfiguration configuration = new YamlConfiguration();
    configuration.loadFromString(yaml);
    configuration.set("baseUrl", "https://realfiction.live");
    configuration.set("hmacSecret", "test-secret");
    return RealCoreConfig.from(configuration);
  }
}
