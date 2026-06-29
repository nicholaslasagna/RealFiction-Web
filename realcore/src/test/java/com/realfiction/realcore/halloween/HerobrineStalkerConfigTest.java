package com.realfiction.realcore.halloween;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.config.RealCoreConfig;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class HerobrineStalkerConfigTest {
  @Test
  void loadsConfigAndNormalizesWorldAndServerGates() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        halloween:
          enabled: true
          herobrineStalker:
            enabled: true
            dryRun: true
            dateWindow:
              startMonth: 10
              startDay: 15
              endMonth: 11
              endDay: 1
            servers:
              allowlist:
                - SMP-1
              denylist:
                - anarchy
            worlds:
              allowlist:
                - world
              denylist:
                - Void_Spawn
            chancePerCheck: 0.025
            checkIntervalSeconds: 2
            perPlayerCooldownSeconds: 600
            globalCooldownSeconds: 45
            minSpawnDistance: 24
            maxSpawnDistance: 48
            minLingerSeconds: 5
            maxLingerSeconds: 12
            debug: true
        """);

    HalloweenConfig config = HalloweenConfig.from(yaml.getConfigurationSection("halloween"));
    HerobrineStalkerConfig stalker = config.herobrineStalker();

    assertTrue(config.enabled());
    assertTrue(stalker.enabled());
    assertTrue(stalker.dryRun());
    assertTrue(stalker.debug());
    assertEquals(0.025, stalker.chancePerCheck(), 0.0001);
    assertEquals(5, stalker.checkInterval().toSeconds());
    assertEquals(2, stalker.maxActiveSightings());
    assertEquals(64, stalker.minDistanceFromWorldSpawn());
    assertEquals(3, stalker.avoidPlayerBaseBlocksRadius());
    assertEquals(12, stalker.playerStateGrace().toSeconds());
    assertTrue(stalker.cleanupStaleSightings());
    assertTrue(stalker.serverAllowed("smp-1", "smp"));
    assertFalse(stalker.serverAllowed("anarchy-1", "anarchy"));
    assertFalse(stalker.serverAllowed("survival-1", "anarchy"));
    assertTrue(stalker.worldAllowed("world"));
    assertFalse(stalker.worldAllowed("Void_Spawn"));
  }

  @Test
  void realCoreConfigIncludesHalloweenDefaults() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        hmacSecret: secret
        """);

    RealCoreConfig config = RealCoreConfig.from(yaml);

    assertTrue(config.halloween().enabled());
    assertTrue(config.halloween().herobrineStalker().enabled());
    assertEquals(24, config.halloween().herobrineStalker().minSpawnDistance());
    assertFalse(config.halloween().herobrineStalker().worldAllowed("Void_Spawn"));
    assertFalse(config.halloween().herobrineStalker().worldAllowed("Lobby_Games"));
    assertFalse(config.halloween().herobrineStalker().serverAllowed("lobby-1", "lobby"));
    assertFalse(config.halloween().herobrineStalker().serverAllowed("arcade-1", "arcade"));
    assertFalse(config.halloween().herobrineStalker().serverAllowed("anarchy-1", "anarchy"));
    assertEquals(2, config.halloween().herobrineStalker().maxActiveSightings());
    assertEquals(64, config.halloween().herobrineStalker().minDistanceFromWorldSpawn());
    assertEquals(3, config.halloween().herobrineStalker().avoidPlayerBaseBlocksRadius());
    assertEquals(12, config.halloween().herobrineStalker().playerStateGrace().toSeconds());
    assertTrue(config.halloween().herobrineStalker().cleanupStaleSightings());
  }

  @Test
  void invalidDateValuesClampSafely() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        halloween:
          herobrineStalker:
            dateWindow:
              startMonth: 2
              startDay: 31
              endMonth: 99
              endDay: 99
        """);

    HerobrineStalkerConfig stalker = HalloweenConfig.from(yaml.getConfigurationSection("halloween")).herobrineStalker();

    assertEquals("2/29-12/31", stalker.dateWindow().summary());
  }

  @Test
  void anarchyIsBlockedEvenIfAllowlisted() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        halloween:
          herobrineStalker:
            servers:
              allowlist:
                - anarchy
                - anarchy-1
        """);

    HerobrineStalkerConfig stalker = HalloweenConfig.from(yaml.getConfigurationSection("halloween")).herobrineStalker();

    assertFalse(stalker.serverAllowed("anarchy-1", "anarchy"));
  }
}
