package com.realfiction.realcore.economy;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public final class EconomyTransaction {
  private final UUID minecraftUuid;
  private final String minecraftUsername;
  private final long amountMinor;
  private final EconomyCategory category;
  private final String reason;
  private final String idempotencyKey;
  private final String externalRefType;
  private final String externalRefId;
  private final Map<String, Object> metadata;

  public EconomyTransaction(UUID minecraftUuid, String minecraftUsername, long amountMinor,
                            EconomyCategory category, String reason, String idempotencyKey,
                            String externalRefType, String externalRefId, Map<String, Object> metadata) {
    this.minecraftUuid = Objects.requireNonNull(minecraftUuid, "minecraftUuid");
    this.minecraftUsername = cleanNullable(minecraftUsername);
    this.amountMinor = amountMinor;
    this.category = Objects.requireNonNull(category, "category");
    this.reason = requireText(reason, "reason");
    this.idempotencyKey = requireText(idempotencyKey, "idempotencyKey");
    this.externalRefType = cleanNullable(externalRefType);
    this.externalRefId = cleanNullable(externalRefId);
    this.metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    validateAmount(amountMinor, category);
  }

  public static EconomyTransaction credit(UUID minecraftUuid, String minecraftUsername, long amountMinor,
                                          EconomyCategory category, String reason, String idempotencyKey,
                                          String externalRefType, String externalRefId,
                                          Map<String, Object> metadata) {
    if (!category.credit()) {
      throw new IllegalArgumentException("credit transactions must use vote_reward or gameplay_earn");
    }
    return new EconomyTransaction(minecraftUuid, minecraftUsername, Math.abs(amountMinor), category, reason,
        idempotencyKey, externalRefType, externalRefId, metadata);
  }

  public static EconomyTransaction spend(UUID minecraftUuid, String minecraftUsername, long amountMinor,
                                         String reason, String idempotencyKey, String externalRefType,
                                         String externalRefId, Map<String, Object> metadata) {
    return debit(minecraftUuid, minecraftUsername, amountMinor, EconomyCategory.SPEND, reason, idempotencyKey,
        externalRefType, externalRefId, metadata);
  }

  public static EconomyTransaction debit(UUID minecraftUuid, String minecraftUsername, long amountMinor,
                                         EconomyCategory category, String reason, String idempotencyKey,
                                         String externalRefType, String externalRefId,
                                         Map<String, Object> metadata) {
    if (!category.debit()) {
      throw new IllegalArgumentException("debit transactions must use a spend category");
    }
    return new EconomyTransaction(minecraftUuid, minecraftUsername, -Math.abs(amountMinor), category, reason,
        idempotencyKey, externalRefType, externalRefId, metadata);
  }

  public static String stableIdempotencyKey(String serverId, EconomyCategory category, UUID minecraftUuid,
                                            String externalRefType, String externalRefId) {
    String source = requireText(serverId, "serverId") + "|"
        + category.apiValue() + "|"
        + Objects.requireNonNull(minecraftUuid, "minecraftUuid") + "|"
        + requireText(externalRefType, "externalRefType").toLowerCase(Locale.ROOT) + "|"
        + requireText(externalRefId, "externalRefId");
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      return "realcore-economy-" + HexFormat.of().formatHex(digest.digest(source.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException error) {
      throw new IllegalStateException("SHA-256 is unavailable", error);
    }
  }

  public UUID minecraftUuid() {
    return minecraftUuid;
  }

  public String minecraftUsername() {
    return minecraftUsername;
  }

  public long amountMinor() {
    return amountMinor;
  }

  public EconomyCategory category() {
    return category;
  }

  public String reason() {
    return reason;
  }

  public String idempotencyKey() {
    return idempotencyKey;
  }

  public String externalRefType() {
    return externalRefType;
  }

  public String externalRefId() {
    return externalRefId;
  }

  public Map<String, Object> metadata() {
    return metadata;
  }

  private static void validateAmount(long amountMinor, EconomyCategory category) {
    if (amountMinor == 0) {
      throw new IllegalArgumentException("amountMinor must be non-zero");
    }
    if (category.credit() && amountMinor < 0) {
      throw new IllegalArgumentException(category.apiValue() + " must be a positive credit");
    }
    if (category.debit() && amountMinor > 0) {
      throw new IllegalArgumentException(category.apiValue() + " must be a negative debit");
    }
  }

  private static String cleanNullable(String value) {
    if (value == null || value.isBlank()) {
      return null;
    }
    return value.trim();
  }

  private static String requireText(String value, String field) {
    if (value == null || value.isBlank()) {
      throw new IllegalArgumentException(field + " is required");
    }
    return value.trim();
  }
}
