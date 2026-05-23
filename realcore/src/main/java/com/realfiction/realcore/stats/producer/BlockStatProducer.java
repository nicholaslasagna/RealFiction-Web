package com.realfiction.realcore.stats.producer;

import com.realfiction.realcore.stats.NetworkStatWriter;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;

/**
 * Pure logic for the blocks-broken producer. The Bukkit listener unwraps the
 * event and delegates here. Volume is potentially very high (a busy SMP fires
 * many breaks per second per player) but the writer aggregates by
 * (statKey, subjectId) so each flush window collapses to one event per player.
 */
public final class BlockStatProducer {
  private final NetworkStatWriter writer;
  private final String group;

  public BlockStatProducer(NetworkStatWriter writer, String group) {
    this.writer = Objects.requireNonNull(writer, "writer");
    this.group = group;
  }

  public void recordBreak(UUID playerUuid, String playerName) {
    if (playerUuid == null) {
      return;
    }
    writer.increment("blocks_broken.total", playerUuid, playerName, 1);
    String scope = scopedKey();
    if (scope != null) {
      writer.increment(scope, playerUuid, playerName, 1);
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
    return "blocks_broken." + normalized;
  }
}
