package com.realfiction.realcore.economy;

import com.realfiction.realcore.config.EconomyConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

public final class EconomyStagingTestTransaction {
  public static final String EXTERNAL_REF_TYPE = "realcore-staging-test";
  public static final EconomyCategory CATEGORY = EconomyCategory.GAMEPLAY_EARN;

  private EconomyStagingTestTransaction() {
  }

  public static EconomyTransaction create(RealCoreConfig config, UUID minecraftUuid, String minecraftUsername,
                                          long amountMinor, String testId) {
    EconomyConfig economy = config.economy();
    if (!economy.enabled()) {
      throw new IllegalStateException("economy.enabled is false");
    }
    if ("anarchy".equalsIgnoreCase(config.serverGroup())) {
      throw new IllegalStateException("Anarchy is read-only for the global economy");
    }
    if (amountMinor <= 0) {
      throw new IllegalArgumentException("amountMinor must be positive");
    }
    if (amountMinor > economy.stagingTestMaxCreditMinor()) {
      throw new IllegalArgumentException("amountMinor is above economy.stagingTestMaxCreditMinor");
    }

    String externalRefId = normalizeTestId(testId);
    String idempotencyKey = EconomyTransaction.stableIdempotencyKey(
        config.serverId(),
        CATEGORY,
        minecraftUuid,
        EXTERNAL_REF_TYPE,
        externalRefId
    );

    return EconomyTransaction.credit(
        minecraftUuid,
        minecraftUsername,
        amountMinor,
        CATEGORY,
        "RealCore staging economy test",
        idempotencyKey,
        EXTERNAL_REF_TYPE,
        externalRefId,
        Map.of(
            "source", "rf economy test",
            "serverId", config.serverId(),
            "serverGroup", config.serverGroup(),
            "testId", externalRefId
        )
    );
  }

  private static String normalizeTestId(String testId) {
    if (testId == null || testId.isBlank()) {
      throw new IllegalArgumentException("testId is required");
    }
    String normalized = testId.trim().toLowerCase(Locale.ROOT);
    if (!normalized.matches("^[a-z0-9_.:-]{3,80}$")) {
      throw new IllegalArgumentException("testId must be 3-80 letters, numbers, dots, dashes, underscores, or colons");
    }
    return normalized;
  }
}
