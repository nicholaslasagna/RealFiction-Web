package com.realfiction.realcore.rewards;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.api.dto.RewardPayload;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.economy.VoteRewardLedgerShadowService;
import com.realfiction.realcore.economy.VoteRewardLedgerWriteService;
import com.realfiction.realcore.luckperms.LuckPermsService;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.logging.Level;
import java.util.logging.Logger;

public final class RewardDispatcher {
  private final Logger logger;
  private final RealCoreConfig config;
  private final RealCoreScheduler scheduler;
  private final LuckPermsService luckPermsService;
  private final VoteRewardLedgerShadowService voteRewardLedgerShadowService;
  private final VoteRewardLedgerWriteService voteRewardLedgerWriteService;

  public RewardDispatcher(RealCorePlugin plugin, RealCoreConfig config, RealCoreScheduler scheduler,
                          LuckPermsService luckPermsService,
                          VoteRewardLedgerShadowService voteRewardLedgerShadowService,
                          VoteRewardLedgerWriteService voteRewardLedgerWriteService) {
    this(plugin.getLogger(), config, scheduler, luckPermsService,
        voteRewardLedgerShadowService, voteRewardLedgerWriteService);
  }

  RewardDispatcher(Logger logger, RealCoreConfig config, RealCoreScheduler scheduler,
                   LuckPermsService luckPermsService,
                   VoteRewardLedgerShadowService voteRewardLedgerShadowService,
                   VoteRewardLedgerWriteService voteRewardLedgerWriteService) {
    this.logger = logger;
    this.config = config;
    this.scheduler = scheduler;
    this.luckPermsService = luckPermsService;
    this.voteRewardLedgerShadowService = voteRewardLedgerShadowService;
    this.voteRewardLedgerWriteService = voteRewardLedgerWriteService;
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
    List<String> notificationCommands = new ArrayList<>();
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

    List<String> rewardCommands = RewardCommandFormatter.commandsFor(config, reward);

    for (String message : playerMessagesFor(reward)) {
      String player = reward.minecraftUsername();
      if (notBlank(player)) {
        notificationCommands.add("tellraw " + player + " " + jsonText(message));
      }
    }

    if (config.rewardBroadcastsEnabled()) {
      for (String message : broadcastMessagesFor(reward)) {
        notificationCommands.add("broadcast " + message);
      }
    }

    if (isGiftCard(reward)) {
      return CompletableFuture.completedFuture(RewardDeliveryResult.failed(reward.id, "Gift card rewards must be delivered by the website."));
    }

    if (shouldAttemptVoteRewardLedgerWrite(reward)) {
      return dispatchWithVoteRewardLedgerWrite(reward, tasks, rewardCommands, notificationCommands);
    }

    for (String command : rewardCommands) {
      tasks.add(dispatchRewardCommand(command, reward));
    }
    for (String command : notificationCommands) {
      tasks.add(scheduler.dispatchConsoleCommand(command));
    }

    if (tasks.isEmpty()) {
      return CompletableFuture.completedFuture(RewardDeliveryResult.failed(reward.id, "No local handler is configured for this reward."));
    }

    return CompletableFuture.allOf(tasks.toArray(CompletableFuture[]::new))
        .thenApply(ignored -> {
          observeVoteRewardLedgerShadow(reward);
          return RewardDeliveryResult.delivered(reward.id);
        })
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

  private void observeVoteRewardLedgerShadow(RewardPayload reward) {
    if (voteRewardLedgerShadowService == null) {
      return;
    }
    try {
      voteRewardLedgerShadowService.observe(reward);
    } catch (RuntimeException error) {
      logger.warning("Vote reward ledger shadow failed without changing reward delivery: " + cleanMessage(error));
    }
  }

  private boolean shouldAttemptVoteRewardLedgerWrite(RewardPayload reward) {
    return voteRewardLedgerWriteService != null && voteRewardLedgerWriteService.canAttempt(reward);
  }

  private CompletableFuture<RewardDeliveryResult> dispatchWithVoteRewardLedgerWrite(
      RewardPayload reward,
      List<CompletableFuture<Void>> preLedgerTasks,
      List<String> fallbackCommands,
      List<String> notificationCommands
  ) {
    CompletableFuture<Void> prerequisite = preLedgerTasks.isEmpty()
        ? CompletableFuture.completedFuture(null)
        : CompletableFuture.allOf(preLedgerTasks.toArray(CompletableFuture[]::new));

    return prerequisite
        .thenCompose(ignored -> voteRewardLedgerWriteService.write(reward))
        .thenCompose(result -> {
          if (result.delivered()) {
            return finishDeliveredReward(reward, notificationCommands);
          }
          if (!voteRewardLedgerWriteService.fallbackCommandsEnabled()) {
            return CompletableFuture.completedFuture(RewardDeliveryResult.failed(reward.id, result.failureReason()));
          }
          return runFallbackCommands(reward, fallbackCommands, notificationCommands, result.failureReason());
        })
        .exceptionally(error -> RewardDeliveryResult.failed(reward.id, cleanFailure(error)));
  }

  private CompletableFuture<RewardDeliveryResult> runFallbackCommands(
      RewardPayload reward,
      List<String> fallbackCommands,
      List<String> notificationCommands,
      String reason
  ) {
    if (fallbackCommands.isEmpty()) {
      return CompletableFuture.completedFuture(RewardDeliveryResult.failed(
          reward.id,
          "Vote reward ledger write failed and no fallback commands are configured: " + reason
      ));
    }
    voteRewardLedgerWriteService.recordFallbackUsed();
    logger.warning("Vote reward ledger fallback commands running: rewardKey=" + reward.rewardKey
        + " rewardId=" + reward.id + " reason=" + reason);
    List<CompletableFuture<Void>> tasks = new ArrayList<>();
    for (String command : fallbackCommands) {
      tasks.add(dispatchRewardCommand(command, reward));
    }
    return CompletableFuture.allOf(tasks.toArray(CompletableFuture[]::new))
        .thenCompose(ignored -> finishDeliveredReward(reward, notificationCommands))
        .exceptionally(error -> RewardDeliveryResult.failed(reward.id, cleanFailure(error)));
  }

  private CompletableFuture<RewardDeliveryResult> finishDeliveredReward(
      RewardPayload reward,
      List<String> notificationCommands
  ) {
    List<CompletableFuture<Void>> notificationTasks = new ArrayList<>();
    for (String command : notificationCommands) {
      notificationTasks.add(scheduler.dispatchConsoleCommand(command));
    }
    CompletableFuture<Void> notifications = notificationTasks.isEmpty()
        ? CompletableFuture.completedFuture(null)
        : CompletableFuture.allOf(notificationTasks.toArray(CompletableFuture[]::new));
    return notifications.handle((ignored, error) -> {
      if (error != null) {
        logger.warning("Vote reward ledger notification command failed after delivery: " + cleanMessage(error));
      }
      observeVoteRewardLedgerShadow(reward);
      return RewardDeliveryResult.delivered(reward.id);
    });
  }

  private CompletableFuture<Void> dispatchRewardCommand(String command, RewardPayload reward) {
    return scheduler.dispatchConsoleCommand(RewardCommandFormatter.applyPlaceholders(command, reward, config.serverId()));
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

  private List<String> playerMessagesFor(RewardPayload reward) {
    return formatMessages(config.playerMessagesByRewardKey().get(reward.rewardKey), reward);
  }

  private List<String> broadcastMessagesFor(RewardPayload reward) {
    return formatMessages(config.broadcastMessagesByRewardKey().get(reward.rewardKey), reward);
  }

  private List<String> formatMessages(List<String> messages, RewardPayload reward) {
    if (messages == null || messages.isEmpty()) {
      return List.of();
    }
    List<String> formatted = new ArrayList<>();
    for (String message : messages) {
      if (message != null && !message.isBlank()) {
        formatted.add(RewardCommandFormatter.applyPlaceholders(message, reward, config.serverId()));
      }
    }
    return formatted;
  }

  private String jsonText(String value) {
    StringBuilder out = new StringBuilder("{\"text\":\"");
    for (int i = 0; i < value.length(); i++) {
      char ch = value.charAt(i);
      switch (ch) {
        case '\\' -> out.append("\\\\");
        case '"' -> out.append("\\\"");
        case '\n' -> out.append("\\n");
        case '\r' -> out.append("\\r");
        case '\t' -> out.append("\\t");
        default -> out.append(ch);
      }
    }
    out.append("\"}");
    return out.toString();
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
    logger.log(Level.WARNING, "Reward delivery failed: " + message, error);
    return message.length() > 450 ? message.substring(0, 450) : message;
  }

  private String cleanMessage(Throwable error) {
    Throwable cursor = error;
    while (cursor.getCause() != null) {
      cursor = cursor.getCause();
    }
    String message = cursor.getMessage();
    return message == null || message.isBlank() ? cursor.getClass().getSimpleName() : message;
  }

  private boolean notBlank(String value) {
    return value != null && !value.isBlank();
  }

}
