package com.realfiction.realcore.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
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
    assertEquals(100, config.stagingTestMaxCreditMinor());
    assertFalse(config.syncVaultAfterDb());
    assertEquals(100, config.syncVaultMaxDeltaMinor());
    assertFalse(config.voteRewardsToLedger());
    assertTrue(config.voteRewardsLedgerDryRun());
    assertFalse(config.voteRewardsLedgerWritesEnabled());
    assertTrue(config.voteRewardsLedgerFallbackCommands());
    assertFalse(config.vaultDeltaShadowEnabled());
    assertEquals(300, config.vaultDeltaShadowInterval().toSeconds());
    assertEquals(100, config.vaultDeltaShadowMaxPlayersPerRun());
    assertEquals(1, config.vaultDeltaShadowMinDeltaMinor());
    assertEquals(250000, config.vaultDeltaShadowMaxLoggedDeltaMinor());
    assertEquals(List.of("smp-1"), config.vaultDeltaShadowBackendAllowlist());
    assertEquals(5000, config.shadow().warningDeltaMinor());
    assertEquals(50000, config.shadow().severeDeltaMinor());
    assertTrue(config.shadow().ignoreNegativeOneMinorNoise());
    assertEquals(5, config.shadow().repeatedOffenderThreshold());
    assertEquals(500, config.shadow().observationCacheSize());
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
          stagingTestMaxCreditMinor: 250000
          syncVaultAfterDb: true
          syncVaultMaxDeltaMinor: 999999999
          voteRewardsToLedger: true
          voteRewardsLedgerDryRun: false
          voteRewardsLedgerWritesEnabled: true
          voteRewardsLedgerFallbackCommands: false
          vaultDeltaShadowEnabled: true
          vaultDeltaShadowIntervalSeconds: 10
          vaultDeltaShadowMaxPlayersPerRun: 9999
          vaultDeltaShadowMinDeltaMinor: -5
          vaultDeltaShadowMaxLoggedDeltaMinor: 0
          vaultDeltaShadowBackendAllowlist:
            - SMP-1
            - smp-1
            - ""
            - factions-1
          shadow:
            warningDeltaMinor: 0
            severeDeltaMinor: 5
            ignoreNegativeOneMinorNoise: false
            repeatedOffenderThreshold: 0
            observationCacheSize: 2
        """);

    EconomyConfig config = EconomyConfig.from(yaml.getConfigurationSection("economy"));

    assertTrue(config.enabled());
    assertEquals("realfiction_main", config.currencyKey());
    assertEquals(5, config.flushInterval().toSeconds());
    assertEquals(1, config.bufferSize());
    assertEquals(500, config.maxBatchSize());
    assertEquals(5, config.balanceCacheTtl().toSeconds());
    assertEquals(10000, config.stagingTestMaxCreditMinor());
    assertTrue(config.syncVaultAfterDb());
    assertEquals(1000000, config.syncVaultMaxDeltaMinor());
    assertTrue(config.voteRewardsToLedger());
    assertFalse(config.voteRewardsLedgerDryRun());
    assertTrue(config.voteRewardsLedgerWritesEnabled());
    assertFalse(config.voteRewardsLedgerFallbackCommands());
    assertTrue(config.vaultDeltaShadowEnabled());
    assertEquals(60, config.vaultDeltaShadowInterval().toSeconds());
    assertEquals(500, config.vaultDeltaShadowMaxPlayersPerRun());
    assertEquals(0, config.vaultDeltaShadowMinDeltaMinor());
    assertEquals(1, config.vaultDeltaShadowMaxLoggedDeltaMinor());
    assertEquals(List.of("smp-1", "factions-1"), config.vaultDeltaShadowBackendAllowlist());
    assertEquals(1, config.shadow().warningDeltaMinor());
    assertEquals(5, config.shadow().severeDeltaMinor());
    assertFalse(config.shadow().ignoreNegativeOneMinorNoise());
    assertEquals(1, config.shadow().repeatedOffenderThreshold());
    assertEquals(10, config.shadow().observationCacheSize());
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
