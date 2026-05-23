package com.realfiction.realcore.stats.producer;

import com.realfiction.realcore.stats.NetworkStatWriter;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;

/**
 * Pure logic for the kills/deaths producer. The Bukkit listener unwraps the
 * event and delegates here so this class is unit-testable without a Bukkit
 * runtime.
 *
 * <p>For each death we always increment {@code deaths.total} (and the scoped
 * {@code deaths.&lt;group&gt;} when a non-blank, non-{@code all} group is set).
 * If the death has a player killer that is not the victim, we additionally
 * increment {@code kills.total} (and {@code kills.&lt;group&gt;}) for the killer.
 * Mob/environmental kills count as a death only.
 *
 * <p>Folia-safe by construction: we only call into the {@link NetworkStatWriter}
 * which is itself non-blocking (concurrent map writes).
 */
public final class KillStatProducer {
  private final NetworkStatWriter writer;
  private final String group;

  public KillStatProducer(NetworkStatWriter writer, String group) {
    this.writer = Objects.requireNonNull(writer, "writer");
    this.group = group;
  }

  public void recordDeath(UUID victimUuid, String victimName, UUID killerUuid, String killerName) {
    if (victimUuid == null) {
      return;
    }
    writer.increment("deaths.total", victimUuid, victimName, 1);
    String scope = scopedKey("deaths");
    if (scope != null) {
      writer.increment(scope, victimUuid, victimName, 1);
    }
    if (killerUuid != null && !killerUuid.equals(victimUuid)) {
      writer.increment("kills.total", killerUuid, killerName, 1);
      String killScope = scopedKey("kills");
      if (killScope != null) {
        writer.increment(killScope, killerUuid, killerName, 1);
      }
    }
  }

  private String scopedKey(String prefix) {
    if (group == null || group.isBlank()) {
      return null;
    }
    String normalized = group.toLowerCase(Locale.ROOT);
    if ("all".equals(normalized)) {
      return null;
    }
    return prefix + "." + normalized;
  }
}
