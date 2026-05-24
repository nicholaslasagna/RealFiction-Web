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
    long dollars = balanceMinor / Math.max(1, scale);
    long cents = Math.abs(balanceMinor % Math.max(1, scale));
    return "$" + dollars + "." + String.format("%02d", cents);
  }
}
