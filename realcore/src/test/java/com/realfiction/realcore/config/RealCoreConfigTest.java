package com.realfiction.realcore.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class RealCoreConfigTest {
  @Test
  void loadsAndNormalizesStagingConfig() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        baseUrl: "https://staging.realfiction.live/"
        serverId: "Lobby1"
        serverGroup: "global"
        hmacSecret: "test-secret"
        pollIntervalSeconds: 2
        requestTimeoutSeconds: 1
        pollLimit: 500
        debug: true
        capabilities:
          - luckperms
          - vote_rewards
        linking:
          platform: "JAVA"
        rewards:
          productPermissions:
            lobby-flight: "realfiction.lobby.flight"
          commands:
            byRewardKey:
              vote.standard:
                - "eco give {player} 250"
          economy:
            byRewardKey:
              vote.standard:
                amountMinor: 25000
                currencyKey: RealFiction_Main
                category: vote_reward
          messages:
            player:
              byRewardKey:
                vote.standard:
                  - "Thanks for voting for RealFiction! You earned $250."
            broadcast:
              enabled: true
              byRewardKey:
                vote.standard:
                  - "{player} voted for RealFiction and earned a reward!"
        """);

    RealCoreConfig config = RealCoreConfig.from(yaml);

    assertEquals("https://staging.realfiction.live", config.baseUrl().toString());
    assertEquals("Lobby1", config.serverId());
    assertEquals("global", config.serverGroup());
    assertEquals(5, config.pollInterval().toSeconds());
    assertEquals(2, config.requestTimeout().toSeconds());
    assertEquals(100, config.pollLimit());
    assertTrue(config.debug());
    assertTrue(config.hmacSecretConfigured());
    assertEquals("java", config.linkPlatform());
    assertEquals("realfiction.lobby.flight", config.productPermissions().get("lobby-flight"));
    assertEquals(1, config.commandsByRewardKey().get("vote.standard").size());
    assertEquals(25000, config.rewardEconomy().byRewardKey().get("vote.standard").amountMinor());
    assertEquals("realfiction_main", config.rewardEconomy().byRewardKey().get("vote.standard").currencyKey());
    assertEquals(1, config.playerMessagesByRewardKey().get("vote.standard").size());
    assertTrue(config.rewardBroadcastsEnabled());
    assertEquals(1, config.broadcastMessagesByRewardKey().get("vote.standard").size());
    assertFalse(config.economy().enabled());
    assertFalse(config.modules().economy());
  }

  @Test
  void detectsMissingHmacSecret() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        hmacSecret: "CHANGE_ME"
        """);

    RealCoreConfig config = RealCoreConfig.from(yaml);

    assertFalse(config.hmacSecretConfigured());
  }

  @Test
  void rejectsRelativeBaseUrl() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        baseUrl: "realfiction.live"
        """);

    assertThrows(IllegalArgumentException.class, () -> RealCoreConfig.from(yaml));
  }
}
