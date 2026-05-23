package com.realfiction.realcore.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class StatsProducerConfigTest {
  @Test
  void defaultsAreSafe() {
    StatsConfig.ProducerConfig defaults = StatsConfig.ProducerConfig.defaults();
    assertTrue(defaults.killsDeaths());
    assertTrue(defaults.blocksBroken());
    assertTrue(defaults.votes());
    assertFalse(defaults.economyMirror(), "economy mirror must default OFF (Vault dependency)");
    assertEquals(300, defaults.economyMirrorIntervalSeconds());
  }

  @Test
  void parsesProducerToggles() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        stats:
          producers:
            killsDeaths: false
            blocksBroken: false
            votes: false
            economyMirror: true
            economyMirrorSeconds: 600
        """);

    StatsConfig statsConfig = StatsConfig.from(yaml.getConfigurationSection("stats"));
    StatsConfig.ProducerConfig producers = statsConfig.producers();
    assertFalse(producers.killsDeaths());
    assertFalse(producers.blocksBroken());
    assertFalse(producers.votes());
    assertTrue(producers.economyMirror());
    assertEquals(600, producers.economyMirrorIntervalSeconds());
  }

  @Test
  void clampsEconomyMirrorIntervalLowerBound() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        stats:
          producers:
            economyMirrorSeconds: 5
        """);

    StatsConfig statsConfig = StatsConfig.from(yaml.getConfigurationSection("stats"));
    assertEquals(60, statsConfig.producers().economyMirrorIntervalSeconds());
  }

  @Test
  void emptyStatsSectionUsesDefaults() {
    StatsConfig statsConfig = StatsConfig.from(null);
    assertTrue(statsConfig.producers().killsDeaths());
    assertFalse(statsConfig.producers().economyMirror());
    assertEquals(30, statsConfig.writer().flushIntervalSeconds());
    assertEquals(50_000, statsConfig.writer().bufferSize());
  }
}
