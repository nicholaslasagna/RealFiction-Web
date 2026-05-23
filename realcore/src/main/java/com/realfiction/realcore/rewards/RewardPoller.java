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
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.logging.Level;

public final class RewardPoller {
  private static final int ACK_BATCH_LIMIT = 100;

  private final RealCorePlugin plugin;
  private final RealCoreConfig config;
  private final RealCoreScheduler scheduler;
  private final PlatformApiClient apiClient;
  private final RewardDispatcher dispatcher;
  private final AtomicBoolean tickRunning = new AtomicBoolean(false);
  private final AtomicBoolean running = new AtomicBoolean(false);
  // rewardId -> pending acknowledgement. Keyed by id so a reward can never be
  // queued (or acked) more than once, even if both the reclaim re-poll and a
  // prior failed ack reference it.
  private final Map<String, PendingAck> pendingAcks = new ConcurrentHashMap<>();
  // rewardIds currently inside an in-flight ack request; prevents an overlapping
  // operation from sending the same reward twice (no duplicate "Acknowledged").
  private final Set<String> ackInFlight = ConcurrentHashMap.newKeySet();
  private final RewardLedger ledger;
  private ScheduledTaskHandle taskHandle;
  // Observer for confirmed first-time deliveries. Used by VoteStatProducer to
  // count vote.standard rewards exactly once per real vote. Writes to the stat
  // writer's in-memory buffer only, so the poll/ack reliability path is
  // unaffected by it. Defaults to a no-op so the poller works whether or not
  // the stats subsystem is wired up.
  private volatile Consumer<RewardPayload> deliveryObserver = ignored -> {};

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

  // ---- Observability -------------------------------------------------------

  public int pendingAckCount() {
    return pendingAcks.size();
  }

  public int deliveredLedgerSize() {
    return ledger.size();
  }

  /** Human-readable lines describing the rewards still awaiting acknowledgement. */
  public List<String> pendingAckSummaries(int limit) {
    long now = System.currentTimeMillis();
    List<String> out = new ArrayList<>();
    for (PendingAck pending : pendingAcks.values()) {
      if (out.size() >= limit) {
        break;
      }
      long nextInSeconds = Math.max(0L, (pending.nextRetryAtMillis - now) / 1000L);
      out.add(pending.delivery.rewardId
          + " status=" + pending.delivery.status
          + " attempts=" + pending.attempts
          + " nextRetry=" + nextInSeconds + "s");
    }
    return out;
  }

  // ---- Tick ----------------------------------------------------------------

  private void tickSafely() {
    // Single in-flight tick at a time; overlapping scheduler fires are skipped.
    if (!running.get() || !tickRunning.compareAndSet(false, true)) {
      return;
    }

    pollAndDeliver()
        .thenCompose(ignored -> flushDueAcks())
        .exceptionally(error -> {
          plugin.getLogger().log(Level.WARNING, "Reward tick failed: " + describeFailure(error), error);
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
              plugin.getLogger().info("No RealFiction rewards pending (pendingAcks=" + pendingAcks.size() + ").");
            }
            return CompletableFuture.completedFuture(null);
          }
          return deliverRewards(response);
        });
  }

  private CompletableFuture<Void> deliverRewards(PollRewardsResponse response) {
    CompletableFuture<Void> chain = CompletableFuture.completedFuture(null);

    // Deliver sequentially so the ledger is updated before the next reward runs.
    for (RewardPayload reward : response.rewards) {
      chain = chain.thenCompose(ignored -> deliverOne(reward).thenAccept(result -> {
        if (result != null) {
          queueAck(result.toAckDelivery());
        }
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
    // re-acknowledge it as delivered. This prevents duplicate money/perks and
    // also serves as the in-run duplicate guard (the ledger is updated before the
    // next reward in the batch is processed).
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
        notifyDeliveryObserver(reward);
        plugin.getLogger().info("Delivered reward " + reward.rewardKey + " -> " + who);
      }
      return result;
    });
  }

  /**
   * Register a callback invoked exactly once per <em>fresh</em> reward delivery
   * (after the ledger is updated, before the ack is queued). Re-acks of an
   * already-delivered reward do <em>not</em> invoke the callback, preserving
   * idempotent vote-counting. Setting {@code null} clears the callback.
   *
   * <p>The reliability contract (poll → deliver → ack) is independent of the
   * observer: any throwable from the observer is caught and logged, never
   * propagated.
   */
  public void setDeliveryObserver(Consumer<RewardPayload> observer) {
    this.deliveryObserver = observer == null ? ignored -> {} : observer;
  }

  private void notifyDeliveryObserver(RewardPayload reward) {
    try {
      deliveryObserver.accept(reward);
    } catch (Throwable error) {
      plugin.getLogger().log(Level.WARNING, "Reward delivery observer threw; ignoring", error);
    }
  }

  // ---- Acknowledgement pipeline -------------------------------------------

  private void queueAck(AckRewardsRequest.Delivery delivery) {
    if (delivery == null || delivery.rewardId == null) {
      return;
    }
    // Dedup by rewardId. If it is already pending we keep the existing retry
    // state (so backoff is not reset by a reclaim re-ack).
    pendingAcks.putIfAbsent(delivery.rewardId, new PendingAck(delivery));
  }

  private CompletableFuture<Void> flushDueAcks() {
    if (!running.get() || pendingAcks.isEmpty()) {
      return CompletableFuture.completedFuture(null);
    }

    long now = System.currentTimeMillis();
    List<AckRewardsRequest.Delivery> batch = new ArrayList<>();
    for (PendingAck pending : pendingAcks.values()) {
      if (batch.size() >= ACK_BATCH_LIMIT) {
        break;
      }
      String id = pending.delivery.rewardId;
      // Respect backoff and never include a reward already in an in-flight ack.
      if (pending.nextRetryAtMillis <= now && ackInFlight.add(id)) {
        pending.attempts++;
        pending.lastAttemptAtMillis = now;
        batch.add(pending.delivery);
      }
    }

    if (batch.isEmpty()) {
      return CompletableFuture.completedFuture(null);
    }

    return apiClient.ackRewards(new AckRewardsRequest(config.serverId(), batch))
        .handle((response, error) -> {
          handleAckResult(batch, response, error);
          return null;
        });
  }

  private void handleAckResult(List<AckRewardsRequest.Delivery> batch, AckRewardsResponse response, Throwable error) {
    try {
      if (error != null) {
        // Whole request failed (network/HTTP); keep every id and back off.
        for (AckRewardsRequest.Delivery delivery : batch) {
          scheduleRetry(delivery.rewardId);
        }
        plugin.getLogger().log(Level.WARNING,
            "Reward ack request failed; backing off: " + describeFailure(error), error);
        return;
      }

      Map<String, AckRewardsResponse.Result> byId = new HashMap<>();
      if (response != null && response.results != null) {
        for (AckRewardsResponse.Result result : response.results) {
          if (result != null && result.rewardId != null) {
            byId.put(result.rewardId, result);
          }
        }
      }

      for (AckRewardsRequest.Delivery delivery : batch) {
        AckRewardsResponse.Result result = byId.get(delivery.rewardId);
        if (result != null && result.accepted) {
          // Settled: drop it so we never ack or log it again.
          pendingAcks.remove(delivery.rewardId);
          plugin.getLogger().info("Acknowledged rewardId=" + delivery.rewardId
              + " status=" + result.status + " duplicate=" + result.duplicate);
        } else {
          scheduleRetry(delivery.rewardId);
          String detail = result != null && result.error != null ? result.error : "no result returned";
          plugin.getLogger().warning("Ack not accepted for rewardId=" + delivery.rewardId
              + " (" + detail + "); backing off (attempt " + attemptsOf(delivery.rewardId) + ").");
        }
      }
    } finally {
      // Always release the in-flight guard for everything we attempted.
      for (AckRewardsRequest.Delivery delivery : batch) {
        ackInFlight.remove(delivery.rewardId);
      }
    }
  }

  private void scheduleRetry(String rewardId) {
    PendingAck pending = pendingAcks.get(rewardId);
    if (pending == null) {
      return;
    }
    long backoff = RewardAckRetryPolicy.backoffMillis(
        pending.attempts, config.pollInterval().toMillis(), ThreadLocalRandom.current());
    pending.nextRetryAtMillis = System.currentTimeMillis() + backoff;
  }

  private int attemptsOf(String rewardId) {
    PendingAck pending = pendingAcks.get(rewardId);
    return pending == null ? 0 : pending.attempts;
  }

  private String playerLabel(RewardPayload reward) {
    String name = reward.minecraftUsername();
    if (name != null && !name.isBlank()) {
      return name;
    }
    String uuid = reward.minecraftUuid();
    return uuid == null || uuid.isBlank() ? "unknown" : uuid;
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

  private static final class PendingAck {
    private final AckRewardsRequest.Delivery delivery;
    private int attempts;
    private long nextRetryAtMillis;
    private long lastAttemptAtMillis;

    private PendingAck(AckRewardsRequest.Delivery delivery) {
      this.delivery = delivery;
      this.attempts = 0;
      this.nextRetryAtMillis = 0L;
      this.lastAttemptAtMillis = 0L;
    }
  }
}
