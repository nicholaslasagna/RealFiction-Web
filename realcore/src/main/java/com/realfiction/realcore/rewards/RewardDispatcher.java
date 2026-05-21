package com.realfiction.realcore.rewards;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.api.dto.RewardPayload;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.luckperms.LuckPermsService;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

public final class RewardDispatcher {
  private final RealCorePlugin plugin;
  private final RealCoreConfig config;
  private final RealCoreScheduler scheduler;
  private final LuckPermsService luckPermsService;

  public RewardDispatcher(RealCorePlugin plugin, RealCoreConfig config, RealCoreScheduler scheduler, LuckPermsService luckPermsService) {
    this.plugin = plugin;
    this.config = config;
    this.scheduler = scheduler;
    this.luckPermsService = luckPermsService;
  }

  public CompletableFuture<RewardDeliveryResult> dispatch(RewardPayload reward) {
    if (reward == null || reward.id == null || reward.id.isBlank()) {
      return CompletableFuture.completedFuture(RewardDeliveryResult.failed("unknown", "Reward payload was missing an id."));
    }

    if (reward.delivery == null) {
      return CompletableFuture.completedFuture(RewardDeliveryResult.failed(reward.id, "Reward delivery data was missing."));
    }

    if (!reward.delivery.safeReward && !config.allowUnsafeRewards()) {
      return CompletableFuture.completedFuture(RewardDeliveryResult.failed(reward.id, "Unsafe reward rejected by RealCore."));
    }

    if (!allowedRewardKey(reward.rewardKey)) {
      return CompletableFuture.completedFuture(RewardDeliveryResult.failed(reward.id, "Reward key is not allowed: " + reward.rewardKey));
    }

    List<CompletableFuture<Void>> tasks = new ArrayList<>();
    String productSlug = reward.delivery.productSlug;

    if (hasLuckPermsPayload(reward)) {
      tasks.add(luckPermsService.apply(reward));
    }

    String mappedPermission = productSlug == null ? null : config.productPermissions().get(productSlug);
    if (mappedPermission != null && !mappedPermission.isBlank()) {
      UUID uuid = parseUuid(reward.minecraftUuid());
      if (uuid == null) {
        return CompletableFuture.completedFuture(RewardDeliveryResult.failed(reward.id, "Reward target is missing a valid Minecraft UUID."));
      }
      if ("revoke".equalsIgnoreCase(reward.action())) {
        tasks.add(luckPermsService.revokePermission(uuid, mappedPermission));
      } else {
        tasks.add(luckPermsService.grantPermission(uuid, mappedPermission, durationFor(reward)));
      }
    }

    for (String command : RewardCommandFormatter.commandsFor(config, reward)) {
      tasks.add(scheduler.dispatchConsoleCommand(RewardCommandFormatter.applyPlaceholders(command, reward, config.serverId())));
    }

    if (isGiftCard(reward)) {
      return CompletableFuture.completedFuture(RewardDeliveryResult.failed(reward.id, "Gift card rewards must be delivered by the website."));
    }

    if (tasks.isEmpty()) {
      return CompletableFuture.completedFuture(RewardDeliveryResult.failed(reward.id, "No local handler is configured for this reward."));
    }

    return CompletableFuture.allOf(tasks.toArray(CompletableFuture[]::new))
        .thenApply(ignored -> RewardDeliveryResult.delivered(reward.id))
        .exceptionally(error -> RewardDeliveryResult.failed(reward.id, cleanFailure(error)));
  }

  private boolean hasLuckPermsPayload(RewardPayload reward) {
    if (reward.delivery == null || reward.delivery.luckPerms == null) {
      return false;
    }
    RewardPayload.LuckPermsPayload lp = reward.delivery.luckPerms;
    return notBlank(lp.group) || notBlank(lp.permission) || notBlank(lp.prefix) || notBlank(lp.suffix);
  }

  private boolean isGiftCard(RewardPayload reward) {
    return reward.delivery != null
        && reward.delivery.giftCard != null
        && reward.delivery.giftCard.valueCents != null
        && reward.delivery.giftCard.valueCents > 0;
  }

  private boolean allowedRewardKey(String rewardKey) {
    if (!notBlank(rewardKey)) {
      return false;
    }
    String key = rewardKey.toLowerCase(Locale.ROOT);
    return key.startsWith("store.")
        || key.startsWith("revoke.")
        || key.startsWith("vote.")
        || config.commandsByRewardKey().containsKey(rewardKey);
  }

  private Duration durationFor(RewardPayload reward) {
    if (reward.delivery != null && reward.delivery.durationDays != null && reward.delivery.durationDays > 0) {
      return Duration.ofDays(reward.delivery.durationDays);
    }
    return null;
  }

  private UUID parseUuid(String value) {
    if (!notBlank(value)) {
      return null;
    }
    String normalized = value.trim();
    if (normalized.length() == 32) {
      normalized = normalized.replaceFirst(
          "([0-9a-fA-F]{8})([0-9a-fA-F]{4})([0-9a-fA-F]{4})([0-9a-fA-F]{4})([0-9a-fA-F]{12})",
          "$1-$2-$3-$4-$5"
      );
    }
    try {
      return UUID.fromString(normalized);
    } catch (IllegalArgumentException ignored) {
      return null;
    }
  }

  private String cleanFailure(Throwable error) {
    Throwable cursor = error;
    while (cursor.getCause() != null) {
      cursor = cursor.getCause();
    }
    String message = cursor.getMessage();
    if (message == null || message.isBlank()) {
      message = cursor.getClass().getSimpleName();
    }
    plugin.getLogger().warning("Reward delivery failed: " + message);
    return message.length() > 450 ? message.substring(0, 450) : message;
  }

  private boolean notBlank(String value) {
    return value != null && !value.isBlank();
  }

}
