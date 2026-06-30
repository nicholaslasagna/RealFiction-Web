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
    assertTrue(config.halloween().herobrineStalker().lightningOmen().enabled());
    assertEquals(0.02, config.halloween().herobrineStalker().lightningOmen().chance(), 0.0001);
    assertFalse(config.halloween().herobrineStalker().lightningOmen().damage());
    assertFalse(config.halloween().herobrineStalker().lightningOmen().fire());
    assertTrue(config.halloween().herobrineStalker().miningIntent().enabled());
    assertEquals(1.5, config.halloween().herobrineStalker().miningIntent().chanceMultiplier(), 0.0001);
    assertEquals(42.0, config.halloween().herobrineStalker().miningIntent().vanishViewDegrees(), 0.0001);
    assertTrue(config.halloween().herobrineStalker().distantFootsteps().enabled());
    assertEquals(0.06, config.halloween().herobrineStalker().distantFootsteps().chance(), 0.0001);
    assertEquals(45, config.halloween().herobrineStalker().distantFootsteps().cooldown().toSeconds());
    assertTrue(config.halloween().herobrineStalker().miningFakeout().enabled());
    assertEquals(0.04, config.halloween().herobrineStalker().miningFakeout().chance(), 0.0001);
    assertTrue(config.halloween().herobrineStalker().distantSilhouette().enabled());
    assertEquals(0.10, config.halloween().herobrineStalker().distantSilhouette().chance(), 0.0001);
    assertTrue(config.halloween().herobrineStalker().omenMarker().enabled());
    assertEquals("ash_ring", config.halloween().herobrineStalker().omenMarker().type());
    assertTrue(config.halloween().herobrineStalker().omenMarker().particlesOnly());
    assertTrue(config.halloween().herobrineStalker().lookAwayUnease().enabled());
    assertEquals(90, config.halloween().herobrineStalker().lookAwayUnease().cooldown().toSeconds());
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

  @Test
  void phaseTwoConfigValuesClampSafely() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        halloween:
          herobrineStalker:
            lightningOmen:
              chance: 5
              radius: 99
              minDelaySeconds: 0
              maxDelaySeconds: -1
              damage: true
              fire: true
            miningIntent:
              chanceMultiplier: 99
              vanishViewDegrees: 180
              maxLingerSeconds: 99
            distantFootsteps:
              chance: 5
              minDistance: -1
              maxDistance: -3
              cooldownSeconds: 1
            miningFakeout:
              chance: -2
              radius: 99
              cooldownSeconds: 2
            distantSilhouette:
              chance: 5
              minLingerSeconds: 0
              maxLingerSeconds: 99
            omenMarker:
              chance: 5
              type: "cross"
              lingerSeconds: 99
              particlesOnly: true
            lookAwayUnease:
              chance: 5
              cooldownSeconds: 1
        """);

    HerobrineStalkerConfig stalker = HalloweenConfig.from(yaml.getConfigurationSection("halloween")).herobrineStalker();

    assertEquals(1.0, stalker.lightningOmen().chance(), 0.0001);
    assertEquals(48, stalker.lightningOmen().radius());
    assertEquals(1, stalker.lightningOmen().minDelay().toSeconds());
    assertEquals(1, stalker.lightningOmen().maxDelay().toSeconds());
    assertTrue(stalker.lightningOmen().damage());
    assertTrue(stalker.lightningOmen().fire());
    assertEquals(5.0, stalker.miningIntent().chanceMultiplier(), 0.0001);
    assertEquals(90.0, stalker.miningIntent().vanishViewDegrees(), 0.0001);
    assertEquals(30, stalker.miningIntent().maxLinger().toSeconds());
    assertEquals(1.0, stalker.distantFootsteps().chance(), 0.0001);
    assertEquals(3, stalker.distantFootsteps().minDistance());
    assertEquals(3, stalker.distantFootsteps().maxDistance());
    assertEquals(10, stalker.distantFootsteps().cooldown().toSeconds());
    assertEquals(0.0, stalker.miningFakeout().chance(), 0.0001);
    assertEquals(48, stalker.miningFakeout().radius());
    assertEquals(10, stalker.miningFakeout().cooldown().toSeconds());
    assertEquals(1.0, stalker.distantSilhouette().chance(), 0.0001);
    assertEquals(1, stalker.distantSilhouette().minLinger().toSeconds());
    assertEquals(6, stalker.distantSilhouette().maxLinger().toSeconds());
    assertEquals(1.0, stalker.omenMarker().chance(), 0.0001);
    assertEquals("ash_ring", stalker.omenMarker().type());
    assertEquals(12, stalker.omenMarker().linger().toSeconds());
    assertTrue(stalker.omenMarker().particlesOnly());
    assertEquals(1.0, stalker.lookAwayUnease().chance(), 0.0001);
    assertEquals(30, stalker.lookAwayUnease().cooldown().toSeconds());
  }
}
