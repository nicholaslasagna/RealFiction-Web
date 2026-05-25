package com.realfiction.realcore.rewards;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.realfiction.realcore.api.dto.RewardPayload;
import com.realfiction.realcore.config.EconomyConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.config.RewardEconomyConfig;
import com.realfiction.realcore.config.ServerModules;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class RewardCommandFormatterTest {
  @Test
  void mergesRewardAndProductCommandsAndReplacesPlaceholders() {
    RealCoreConfig config = new RealCoreConfig(
        URI.create("https://realfiction.live"),
        "lobby-1",
        "global",
        "secret",
        Duration.ofSeconds(30),
        Duration.ofSeconds(10),
        25,
        false,
        List.of("luckperms", "vote_rewards"),
        "java",
        false,
        Map.of(),
        Map.of("vote.standard", List.of("eco give {player} {quantity}")),
        Map.of("lobby-flight", List.of("lp user {uuid} permission set {productSlug} true")),
        Map.of("vote.standard", List.of("Thanks for voting on {voteSite}, {player}!")),
        false,
        Map.of(),
        RewardEconomyConfig.empty(),
        "Lobby 1",
        false,
        ServerModules.defaults(),
        Set.of(),
        EconomyConfig.disabledDefaults()
    );

    RewardPayload reward = new RewardPayload();
    reward.id = "reward-1";
    reward.rewardKey = "vote.standard";
    reward.target = new RewardPayload.Target();
    reward.target.minecraftUuid = "11111111-1111-1111-1111-111111111111";
    reward.target.minecraftUsername = "RealPlayer";
    reward.delivery = new RewardPayload.Delivery();
    reward.delivery.productSlug = "lobby-flight";
    reward.delivery.voteSite = "mclist.io";
    reward.delivery.quantity = 3;

    List<String> commands = RewardCommandFormatter.commandsFor(config, reward);

    assertEquals(List.of("eco give {player} {quantity}", "lp user {uuid} permission set {productSlug} true"), commands);
    assertEquals(
        "eco give RealPlayer 3",
        RewardCommandFormatter.applyPlaceholders(commands.get(0), reward, config.serverId())
    );
    assertEquals(
        "lp user 11111111-1111-1111-1111-111111111111 permission set lobby-flight true",
        RewardCommandFormatter.applyPlaceholders(commands.get(1), reward, config.serverId())
    );
    assertEquals(
        "Thanks for voting on mclist.io, RealPlayer!",
        RewardCommandFormatter.applyPlaceholders(config.playerMessagesByRewardKey().get("vote.standard").get(0), reward, config.serverId())
    );
  }

  @Test
  void commandRewardsRemainWhenEconomyShadowMappingExists() throws Exception {
    org.bukkit.configuration.file.YamlConfiguration yaml = new org.bukkit.configuration.file.YamlConfiguration();
    yaml.loadFromString("""
        hmacSecret: "secret"
        rewards:
          economy:
            byRewardKey:
              vote.standard:
                amountMinor: 25000
                currencyKey: realfiction_main
                category: vote_reward
          commands:
            byRewardKey:
              vote.standard:
                - "eco give {player} 250"
        """);
    RealCoreConfig config = RealCoreConfig.from(yaml);

    RewardPayload reward = new RewardPayload();
    reward.id = "reward-1";
    reward.rewardKey = "vote.standard";
    reward.target = new RewardPayload.Target();
    reward.target.minecraftUsername = "RealPlayer";
    reward.delivery = new RewardPayload.Delivery();

    assertEquals(List.of("eco give {player} 250"), RewardCommandFormatter.commandsFor(config, reward));
  }
}
