package com.realfiction.realcore.economy;

import com.realfiction.realcore.config.RealCoreConfig;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Bridge for trusted plugins (RealParkour milestones) to credit gameplay
 * earnings into the canonical gameplay sync ledger via console command.
 *
 * This is a thin validation layer over {@link GenericGameplayEconomyProducerService},
 * which owns all policy: module/economy/gameplaySync enablement, dry-run,
 * Anarchy block, backend allowlist, source allowlist, category flags,
 * per-transaction caps, and idempotency dedup. Only {@code gameplay_earn} is
 * ever produced here — never spend or shop categories. No Vault mutation, no
 * direct DB writes, no HMAC use.
 */
public final class GameplayCreditService {
  /** Safe tokens only: these values flow into ledger reason/source fields. */
  public static final Pattern REASON_PATTERN = Pattern.compile("[a-zA-Z0-9_.:-]{1,80}");
  public static final Pattern SOURCE_PATTERN = Pattern.compile("[a-z0-9_.-]{1,40}");
  public static final Pattern PLAYER_NAME_PATTERN = Pattern.compile("[A-Za-z0-9_]{1,16}");

  public record CreditRequest(
      UUID playerUuid,
      String playerName,
      long amountMinor,
      String source,
      String reason,
      String eventId
  ) {}

  public record CreditResponse(
      boolean accepted,
      boolean dryRun,
      String rejectionReason,
      String idempotencyKey
  ) {
    public static CreditResponse rejected(String reason) {
      return new CreditResponse(false, false, reason, null);
    }
  }

  private GameplayCreditService() {}

  public static CreditResponse credit(
      RealCoreConfig config,
      GenericGameplayEconomyProducerService producer,
      CreditRequest request
  ) {
    Objects.requireNonNull(config, "config");
    Objects.requireNonNull(producer, "producer");
    Objects.requireNonNull(request, "request");

    if (request.playerUuid() == null) {
      return CreditResponse.rejected("player UUID is required");
    }
    if (request.playerName() == null || !PLAYER_NAME_PATTERN.matcher(request.playerName()).matches()) {
      return CreditResponse.rejected("player name must be a valid Minecraft username");
    }
    if (request.amountMinor() <= 0) {
      return CreditResponse.rejected("amountMinor must be a positive integer");
    }
    long maxCredit = config.economy().gameplaySync().maxCreditMinorPerTx();
    if (request.amountMinor() > maxCredit) {
      return CreditResponse.rejected(
          "amountMinor exceeds economy.gameplaySync.maxCreditMinorPerTx (" + maxCredit + ")");
    }
    if (request.source() == null || !SOURCE_PATTERN.matcher(request.source()).matches()) {
      return CreditResponse.rejected("source must be a safe lowercase token (e.g. lobby_parkour)");
    }
    if (request.reason() == null || !REASON_PATTERN.matcher(request.reason()).matches()) {
      return CreditResponse.rejected("reason must be a safe token (e.g. parkour_completion_10)");
    }
    if (request.eventId() == null || request.eventId().isBlank()) {
      return CreditResponse.rejected("eventId is required");
    }

    GameplayEconomyEvent event = GameplayEconomyEvent.create(
        request.playerUuid(),
        request.playerName(),
        request.amountMinor(),
        GameplayEconomyCategory.GAMEPLAY_EARN,
        request.source().trim(),
        request.eventId().trim(),
        request.reason()
    );

    String idempotencyKey = GameplayEconomyIdempotencyKeys.build(
        config.serverId(),
        GameplayEconomyCategory.GAMEPLAY_EARN,
        event.source(),
        event.playerUuid(),
        event.eventId()
    );

    GenericGameplayEconomyProducerService.SubmitResult result = producer.submit(event);
    boolean dryRun = result.dryRun()
        || config.economy().gameplaySync().dryRun()
        || producer.genericConfig().dryRun();
    if (result.accepted()) {
      return new CreditResponse(true, dryRun, null, idempotencyKey);
    }
    return new CreditResponse(false, dryRun, result.rejectionReason(), idempotencyKey);
  }
}
