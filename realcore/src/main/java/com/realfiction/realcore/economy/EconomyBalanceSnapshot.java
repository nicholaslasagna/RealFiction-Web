package com.realfiction.realcore.economy;

import java.time.Instant;
import java.util.UUID;

public record EconomyBalanceSnapshot(
    String currencyKey,
    UUID minecraftUuid,
    String minecraftUsername,
    long balanceMinor,
    int scale,
    Instant updatedAt,
    Instant cachedAt
) {
  public String formattedDollars() {
    return EconomyBalanceFormat.formatMinor(balanceMinor, scale);
  }
}
