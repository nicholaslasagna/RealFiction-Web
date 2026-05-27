package com.realfiction.realcore.economy;

import java.util.Locale;
import java.util.Objects;
import java.util.UUID;

/**
 * Stable idempotency keys for gameplay economy sync.
 *
 * <p>Format: {@code gameplay:<serverId>:<category>:<source>:<playerUuid>:<eventId>}
 *
 * <p>Future producers must pass an explicit {@code source} and {@code eventId}.
 * Do not derive keys from timestamps alone unless a later phase documents a
 * bounded aggregation window and includes that window in {@code eventId}.
 */
public final class GameplayEconomyIdempotencyKeys {
  private GameplayEconomyIdempotencyKeys() {
  }

  public static String build(
      String serverId,
      GameplayEconomyCategory category,
      String source,
      UUID playerUuid,
      String eventId
  ) {
    return "gameplay:"
        + requireToken(serverId, "serverId") + ":"
        + category.ledgerCategory().apiValue() + ":"
        + requireToken(source, "source") + ":"
        + Objects.requireNonNull(playerUuid, "playerUuid") + ":"
        + requireToken(eventId, "eventId");
  }

  private static String requireToken(String value, String field) {
    if (value == null || value.isBlank()) {
      throw new IllegalArgumentException(field + " is required");
    }
    return value.trim().toLowerCase(Locale.ROOT);
  }
}
