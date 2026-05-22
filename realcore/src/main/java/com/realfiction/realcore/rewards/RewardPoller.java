package com.realfiction.realcore.rewards;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.api.PlatformApiException;
import com.realfiction.realcore.api.dto.AckRewardsRequest;
import com.realfiction.realcore.api.dto.AckRewardsResponse;
import com.realfiction.realcore.api.dto.PollRewardsRequest;
import com.realfiction.realcore.api.dto.PollRewardsResponse;
import com.realfiction.realcore.api.dto.RewardPayload;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Queue;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Level;

public final class RewardPoller {
  private final RealCorePlugin plugin;
  private final RealCoreConfig config;
  private final RealCoreScheduler scheduler;
  private final PlatformApiClient apiClient;
  private final RewardDispatcher dispatcher;
  private final AtomicBoolean tickRunning = new AtomicBoolean(false);
  private final AtomicBoolean running = new AtomicBoolean(false);
  private final Set<String> deliveredThisRun = ConcurrentHashMap.newKeySet();
  private final Queue<AckRewardsRequest.Delivery> pendingAcks = new ConcurrentLinkedQueue<>();
  private final RewardLedger ledger;
  private ScheduledTaskHandle taskHandle;

  public RewardPoller(RealCorePlugin plugin, RealCoreConfig config, RealCoreScheduler scheduler, PlatformApiClient apiClient, RewardDispatcher dispatcher) {
    this.plugin = plugin;
    this.config = config;
    this.scheduler = scheduler;
    this.apiClient = apiClient;
    this.dispatcher = dispatcher;
    this.ledger = new RewardLedger(plugin.getDataFolder().toPath().resolve("delivered-rewards.log"), plugin.getLogger());
  }

  public void start() {
    if (!running.compareAndSet(false, true)) {
      return;
    }
    ledger.load();
    taskHandle = scheduler.runAsyncRepeating(this::tickSafely, 3, config.pollInterval().toSeconds());
  }

  public void stop() {
    running.set(false);
    if (taskHandle != null) {
      taskHandle.cancel();
      taskHandle = null;
    }
  }

  public boolean running() {
    return running.get() && taskHandle != null;
  }

  private void tickSafely() {
    if (!running.get() || !tickRunning.compareAndSet(false, true)) {
      return;
    }

    flushPendingAcks()
        .thenCompose(ignored -> pollAndDeliver())
        .exceptionally(error -> {
          plugin.getLogger().log(Level.WARNING, "Reward poll failed: " + describeFailure(error), error);
          return null;
        })
        .whenComplete((ignored, error) -> tickRunning.set(false));
  }

  private CompletableFuture<Void> pollAndDeliver() {
    if (!running.get()) {
      return CompletableFuture.completedFuture(null);
    }

    PollRewardsRequest request = new PollRewardsRequest(
        config.serverId(),
        config.serverGroup(),
        config.pollLimit(),
        config.capabilities()
    );

    return apiClient.pollRewards(request)
        .thenCompose(response -> {
          if (!running.get()) {
            return CompletableFuture.completedFuture(null);
          }
          if (response == null || response.rewards == null || response.rewards.isEmpty()) {
            if (config.debug()) {
              plugin.getLogger().info("No RealFiction rewards pending.");
            }
            return CompletableFuture.completedFuture(null);
          }
          return deliverRewards(response).thenCompose(this::ackOrQueue);
        });
  }

  private CompletableFuture<List<AckRewardsRequest.Delivery>> deliverRewards(PollRewardsResponse response) {
    CompletableFuture<List<AckRewardsRequest.Delivery>> chain = CompletableFuture.completedFuture(new ArrayList<>());

    for (RewardPayload reward : response.rewards) {
      chain = chain.thenCompose(acks -> deliverOne(reward).thenApply(result -> {
        if (result != null) {
          acks.add(result.toAckDelivery());
        }
        return acks;
      }));
    }

    return chain;
  }

  private CompletableFuture<RewardDeliveryResult> deliverOne(RewardPayload reward) {
    if (!running.get()) {
      return CompletableFuture.completedFuture(null);
    }
    if (reward == null || reward.id == null) {
      return CompletableFuture.completedFuture(null);
    }

    String who = playerLabel(reward);

    // Idempotency: if this reward's effects already ran on this server (e.g. the
    // previous ack failed and the row was reclaimed), do NOT execute again - only
    // re-acknowledge it as delivered. This prevents duplicate money/perks.
    if (ledger.wasDelivered(reward.id)) {
      plugin.getLogger().info("Reward already delivered locally; re-acking only: "
          + reward.rewardKey + " -> " + who + " (id=" + reward.id + ")");
      return CompletableFuture.completedFuture(RewardDeliveryResult.delivered(reward.id));
    }

    // Defensive: the website already filters by group, but never apply a reward
    // that is targeted at a different server group than this backend.
    String group = reward.serverGroup;
    if (group != null && !group.isBlank()
        && !group.equalsIgnoreCase("global")
        && !group.equalsIgnoreCase(config.serverGroup())) {
      plugin.getLogger().warning("Skipped reward (wrong server group: " + group + ") rewardKey=" + reward.rewardKey
          + " (this server group=" + config.serverGroup() + ")");
      return CompletableFuture.completedFuture(RewardDeliveryResult.failed(reward.id, "Wrong server group: " + group));
    }

    // Skip placeholder/test votes (e.g. the PlanetMinecraft "PMC" test vote) so
    // they never run economy commands for a non-real player. Acked as failed so
    // the row is settled and not retried.
    String username = reward.minecraftUsername();
    if (username != null && config.skipUsernames().contains(username.toLowerCase(Locale.ROOT))) {
      plugin.getLogger().info("Skipped test/placeholder vote for username '" + username + "' (configured skip).");
      return CompletableFuture.completedFuture(
          RewardDeliveryResult.failed(reward.id, "Skipped configured test username: " + username));
    }

    if (!deliveredThisRun.add(reward.id)) {
      plugin.getLogger().warning("Skipping duplicate reward in same plugin run: rewardId=" + reward.id);
      return CompletableFuture.completedFuture(null);
    }

    if (reward.attempts > 1) {
      plugin.getLogger().info("Retrying reward " + reward.rewardKey + " -> " + who
          + " (attempt " + reward.attempts + ", id=" + reward.id + ")");
    } else {
      plugin.getLogger().info("Claimed reward " + reward.rewardKey + " -> " + who + " (id=" + reward.id + ")");
    }

    return dispatcher.dispatch(reward).thenApply(result -> {
      if (result != null && result.delivered()) {
        // Persist BEFORE the ack so a subsequent ack failure cannot cause a
        // second execution on the next poll.
        ledger.markDelivered(reward.id);
        plugin.getLogger().info("Delivered reward " + reward.rewardKey + " -> " + who);
      }
      return result;
    });
  }

  private String playerLabel(RewardPayload reward) {
    String name = reward.minecraftUsername();
    if (name != null && !name.isBlank()) {
      return name;
    }
    String uuid = reward.minecraftUuid();
    return uuid == null || uuid.isBlank() ? "unknown" : uuid;
  }

  private CompletableFuture<Void> flushPendingAcks() {
    List<AckRewardsRequest.Delivery> batch = new ArrayList<>();
    AckRewardsRequest.Delivery delivery;
    while ((delivery = pendingAcks.poll()) != null && batch.size() < 100) {
      batch.add(delivery);
    }
    if (!batch.isEmpty()) {
      return ackOrQueue(batch);
    }
    return CompletableFuture.completedFuture(null);
  }

  private CompletableFuture<Void> ackOrQueue(List<AckRewardsRequest.Delivery> deliveries) {
    if (deliveries == null || deliveries.isEmpty()) {
      return CompletableFuture.completedFuture(null);
    }
    if (!running.get()) {
      pendingAcks.addAll(deliveries);
      return CompletableFuture.completedFuture(null);
    }

    return apiClient.ackRewards(new AckRewardsRequest(config.serverId(), deliveries))
        .handle((response, error) -> {
      if (RewardAckRetryPolicy.shouldRetry(response, error)) {
        if (error != null) {
          plugin.getLogger().log(Level.WARNING,
              "Could not acknowledge rewards; will retry later: " + describeFailure(error), error);
        } else {
          plugin.getLogger().warning("Reward acknowledgement was not fully accepted; will retry later.");
        }
        pendingAcks.addAll(deliveries);
      }

      if (error != null) {
        return null;
      }

      if (response != null && response.results != null) {
        response.results.forEach(result -> {
          if (result.accepted) {
            plugin.getLogger().info("Acknowledged rewardId=" + result.rewardId + " status=" + result.status + " duplicate=" + result.duplicate);
          } else {
            plugin.getLogger().warning("Ack failed for rewardId=" + result.rewardId + ": " + result.error);
          }
        });
      }
      return null;
    });
  }

  private String cleanMessage(Throwable error) {
    Throwable cursor = error;
    while (cursor.getCause() != null) {
      cursor = cursor.getCause();
    }
    String message = cursor.getMessage();
    return message == null || message.isBlank() ? cursor.getClass().getSimpleName() : message;
  }

  // Includes the HTTP status for website API failures so a 4xx/5xx is visible in
  // logs without dumping secrets. Full stack traces are logged separately.
  private String describeFailure(Throwable error) {
    Throwable cursor = error;
    while (cursor.getCause() != null) {
      cursor = cursor.getCause();
    }
    if (cursor instanceof PlatformApiException api) {
      return "HTTP " + api.statusCode() + " " + cleanMessage(error);
    }
    return cleanMessage(error);
  }
}
