package com.realfiction.realcore.rewards;

import com.realfiction.realcore.api.dto.RewardPayload;
import com.realfiction.realcore.config.RealCoreConfig;
import java.util.ArrayList;
import java.util.List;

final class RewardCommandFormatter {
  private RewardCommandFormatter() {
  }

  static List<String> commandsFor(RealCoreConfig config, RewardPayload reward) {
    List<String> commands = new ArrayList<>();
    List<String> rewardCommands = config.commandsByRewardKey().get(reward.rewardKey);
    if (rewardCommands != null) {
      commands.addAll(rewardCommands);
    }
    if (reward.delivery != null && reward.delivery.productSlug != null) {
      List<String> productCommands = config.commandsByProductSlug().get(reward.delivery.productSlug);
      if (productCommands != null) {
        commands.addAll(productCommands);
      }
    }
    return commands;
  }

  static String applyPlaceholders(String command, RewardPayload reward, String serverId) {
    String player = firstNonBlank(reward.minecraftUsername(), reward.minecraftUuid(), "unknown");
    String uuid = firstNonBlank(reward.minecraftUuid(), "");
    String productSlug = reward.delivery == null ? "" : firstNonBlank(reward.delivery.productSlug, "");
    String quantity = reward.delivery == null ? "1" : Integer.toString(Math.max(1, reward.delivery.quantity));

    return command
        .replace("{player}", player)
        .replace("{username}", player)
        .replace("{uuid}", uuid)
        .replace("{rewardKey}", firstNonBlank(reward.rewardKey, "unknown"))
        .replace("{rewardId}", firstNonBlank(reward.id, "unknown"))
        .replace("{quantity}", quantity)
        .replace("{serverId}", serverId)
        .replace("{productSlug}", productSlug);
  }

  private static String firstNonBlank(String... values) {
    for (String value : values) {
      if (value != null && !value.isBlank()) {
        return value;
      }
    }
    return "";
  }
}
