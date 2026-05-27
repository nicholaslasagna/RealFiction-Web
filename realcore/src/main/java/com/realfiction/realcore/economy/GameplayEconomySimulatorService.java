package com.realfiction.realcore.economy;

import com.realfiction.realcore.config.RealCoreConfig;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;

/**
 * Builds and submits synthetic {@link GameplayEconomyEvent} instances for admin dry-run testing.
 * Does not touch Vault, vote rewards, or shop producers.
 */
public final class GameplayEconomySimulatorService {
  public static final String DEFAULT_SIMULATOR_SOURCE = "manual_simulator";

  public record SimulateRequest(
      String kind,
      UUID playerUuid,
      String playerName,
      long amountMinor,
      String source,
      String eventId
  ) {}

  public record SimulateResponse(
      boolean accepted,
      boolean dryRun,
      String rejectionReason,
      GameplayEconomyCategory category,
      long amountMinor,
      String source,
      String eventId,
      UUID playerUuid,
      String playerName,
      String idempotencyKey
  ) {
    public static SimulateResponse rejected(String reason) {
      return new SimulateResponse(false, false, reason, null, 0, null, null, null, null, null);
    }
  }

  private GameplayEconomySimulatorService() {}

  public static SimulateResponse simulate(
      RealCoreConfig config,
      GenericGameplayEconomyProducerService producer,
      SimulateRequest request
  ) {
    Objects.requireNonNull(config, "config");
    Objects.requireNonNull(producer, "producer");
    Objects.requireNonNull(request, "request");

    GameplayEconomyCategory category = parseKind(request.kind());
    if (category == null) {
      return SimulateResponse.rejected("kind must be earn or spend");
    }
    if (request.playerUuid() == null) {
      return SimulateResponse.rejected("player UUID is required");
    }
    if (request.playerName() == null || request.playerName().isBlank()) {
      return SimulateResponse.rejected("player name is required");
    }
    if (request.amountMinor() <= 0) {
      return SimulateResponse.rejected("amountMinor must be a positive integer");
    }
    if (request.source() == null || request.source().isBlank()) {
      return SimulateResponse.rejected("source is required");
    }
    if (request.eventId() == null || request.eventId().isBlank()) {
      return SimulateResponse.rejected("eventId is required");
    }

    String reason = "Gameplay economy simulator (" + request.kind().toLowerCase(Locale.ROOT) + ")";
    GameplayEconomyEvent event = GameplayEconomyEvent.create(
        request.playerUuid(),
        request.playerName(),
        request.amountMinor(),
        category,
        request.source().trim(),
        request.eventId().trim(),
        reason
    );

    String idempotencyKey = GameplayEconomyIdempotencyKeys.build(
        config.serverId(),
        category,
        event.source(),
        event.playerUuid(),
        event.eventId()
    );

    GenericGameplayEconomyProducerService.SubmitResult result = producer.submit(event);
    boolean dryRun = result.dryRun()
        || config.economy().gameplaySync().dryRun()
        || producer.genericConfig().dryRun();

    if (result.accepted()) {
      return new SimulateResponse(
          true,
          dryRun,
          null,
          category,
          request.amountMinor(),
          event.source(),
          event.eventId(),
          request.playerUuid(),
          request.playerName(),
          idempotencyKey
      );
    }
    return new SimulateResponse(
        false,
        false,
        result.rejectionReason(),
        category,
        request.amountMinor(),
        event.source(),
        event.eventId(),
        request.playerUuid(),
        request.playerName(),
        idempotencyKey
    );
  }

  public static Long parsePositiveAmount(String text) {
    if (text == null || text.isBlank()) {
      return null;
    }
    String trimmed = text.trim();
    if (!trimmed.matches("\\d+")) {
      return null;
    }
    try {
      long value = Long.parseLong(trimmed);
      return value > 0 ? value : null;
    } catch (NumberFormatException ignored) {
      return null;
    }
  }

  public static GameplayEconomyCategory parseKind(String kind) {
    if (kind == null) {
      return null;
    }
    return switch (kind.trim().toLowerCase(Locale.ROOT)) {
      case "earn" -> GameplayEconomyCategory.GAMEPLAY_EARN;
      case "spend" -> GameplayEconomyCategory.GAMEPLAY_SPEND;
      default -> null;
    };
  }
}
