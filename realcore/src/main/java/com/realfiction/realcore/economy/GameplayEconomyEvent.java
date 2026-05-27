package com.realfiction.realcore.economy;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Internal gameplay economy event for non-shop categories only.
 */
public final class GameplayEconomyEvent {
  private final UUID playerUuid;
  private final String playerName;
  private final long amountMinor;
  private final GameplayEconomyCategory category;
  private final String source;
  private final String eventId;
  private final String reason;
  private final Map<String, Object> metadata;
  private final Instant createdAt;

  private GameplayEconomyEvent(
      UUID playerUuid,
      String playerName,
      long amountMinor,
      GameplayEconomyCategory category,
      String source,
      String eventId,
      String reason,
      Map<String, Object> metadata,
      Instant createdAt
  ) {
    this.playerUuid = Objects.requireNonNull(playerUuid, "playerUuid");
    this.playerName = playerName == null ? "" : playerName;
    this.amountMinor = amountMinor;
    this.category = Objects.requireNonNull(category, "category");
    this.source = Objects.requireNonNull(source, "source");
    this.eventId = Objects.requireNonNull(eventId, "eventId");
    this.reason = reason == null ? "" : reason;
    this.metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    this.createdAt = createdAt == null ? Instant.now() : createdAt;
  }

  public static GameplayEconomyEvent create(
      UUID playerUuid,
      String playerName,
      long amountMinor,
      GameplayEconomyCategory category,
      String source,
      String eventId,
      String reason
  ) {
    return create(playerUuid, playerName, amountMinor, category, source, eventId, reason, Map.of(), null);
  }

  public static GameplayEconomyEvent create(
      UUID playerUuid,
      String playerName,
      long amountMinor,
      GameplayEconomyCategory category,
      String source,
      String eventId,
      String reason,
      Map<String, Object> metadata,
      Instant createdAt
  ) {
    if (category != GameplayEconomyCategory.GAMEPLAY_EARN && category != GameplayEconomyCategory.GAMEPLAY_SPEND) {
      throw new IllegalArgumentException(
          "GameplayEconomyEvent only supports gameplay_earn and gameplay_spend, not " + category);
    }
    return new GameplayEconomyEvent(
        playerUuid,
        playerName,
        amountMinor,
        category,
        source,
        eventId,
        reason,
        metadata,
        createdAt
    );
  }

  public UUID playerUuid() {
    return playerUuid;
  }

  public String playerName() {
    return playerName;
  }

  public long amountMinor() {
    return amountMinor;
  }

  public GameplayEconomyCategory category() {
    return category;
  }

  public String source() {
    return source;
  }

  public String eventId() {
    return eventId;
  }

  public String reason() {
    return reason;
  }

  public Map<String, Object> metadata() {
    return metadata;
  }

  public Instant createdAt() {
    return createdAt;
  }
}
