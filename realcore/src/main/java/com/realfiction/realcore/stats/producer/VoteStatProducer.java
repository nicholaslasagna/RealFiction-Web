package com.realfiction.realcore.stats.producer;

import com.realfiction.realcore.api.dto.RewardPayload;
import com.realfiction.realcore.stats.NetworkStatWriter;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Consumer;

/**
 * Counts confirmed votes by observing the reward delivery pipeline.
 *
 * <p>Why this point: a vote arrives at the website webhook, becomes a
 * {@code vote.standard} reward, and is delivered by RealCore's reward poller.
 * Hooking in <em>after</em> a successful first delivery (i.e. after
 * {@code RewardLedger.markDelivered}) gives us a single confirmed vote per
 * player without re-counting on retries or re-acks. Vote-streak rewards
 * ({@code vote.milestone.*}) are intentionally skipped - they are bonuses, not
 * additional votes.
 *
 * <p>The reward poller only invokes the observer in the fresh delivery branch,
 * so there is no double-count when a stuck ack causes the reward to be polled
 * again - the ledger short-circuits the second delivery and the observer is
 * not called.
 */
public final class VoteStatProducer implements Consumer<RewardPayload> {
  private final NetworkStatWriter writer;
  private final String group;

  public VoteStatProducer(NetworkStatWriter writer, String group) {
    this.writer = Objects.requireNonNull(writer, "writer");
    this.group = group;
  }

  @Override
  public void accept(RewardPayload reward) {
    onRewardDelivered(reward);
  }

  public void onRewardDelivered(RewardPayload reward) {
    if (reward == null || reward.rewardKey == null) {
      return;
    }
    if (!"vote.standard".equalsIgnoreCase(reward.rewardKey.trim())) {
      return;
    }
    UUID uuid = parseUuid(reward.minecraftUuid());
    if (uuid == null) {
      return;
    }
    String name = reward.minecraftUsername();
    writer.increment("votes.total", uuid, name, 1);
    String scope = scopedKey();
    if (scope != null) {
      writer.increment(scope, uuid, name, 1);
    }
  }

  private String scopedKey() {
    if (group == null || group.isBlank()) {
      return null;
    }
    String normalized = group.toLowerCase(Locale.ROOT);
    if ("all".equals(normalized)) {
      return null;
    }
    return "votes." + normalized;
  }

  private static UUID parseUuid(String raw) {
    if (raw == null || raw.isBlank()) {
      return null;
    }
    String trimmed = raw.trim();
    if (trimmed.length() == 32) {
      trimmed = trimmed.replaceFirst(
          "([0-9a-fA-F]{8})([0-9a-fA-F]{4})([0-9a-fA-F]{4})([0-9a-fA-F]{4})([0-9a-fA-F]{12})",
          "$1-$2-$3-$4-$5"
      );
    }
    try {
      return UUID.fromString(trimmed);
    } catch (IllegalArgumentException ignored) {
      return null;
    }
  }
}
