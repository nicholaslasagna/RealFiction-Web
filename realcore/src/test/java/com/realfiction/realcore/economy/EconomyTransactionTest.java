package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class EconomyTransactionTest {
  @Test
  void stableIdempotencyKeyIsDeterministic() {
    UUID player = UUID.fromString("00000000-0000-0000-0000-000000000123");

    String first = EconomyTransaction.stableIdempotencyKey("smp-1", EconomyCategory.GAMEPLAY_EARN, player, "quest", "daily-1");
    String second = EconomyTransaction.stableIdempotencyKey("smp-1", EconomyCategory.GAMEPLAY_EARN, player, "quest", "daily-1");

    assertEquals(first, second);
  }

  @Test
  void spendIsAlwaysNegativeMinorUnits() {
    EconomyTransaction transaction = EconomyTransaction.spend(
        UUID.randomUUID(), "Alex", 2500, "Shop purchase", "idem-1", "shop", "hat", Map.of());

    assertEquals(-2500, transaction.amountMinor());
    assertEquals(EconomyCategory.SPEND, transaction.category());
  }

  @Test
  void rejectsWrongSigns() {
    assertThrows(IllegalArgumentException.class, () -> new EconomyTransaction(
        UUID.randomUUID(), "Alex", -1, EconomyCategory.GAMEPLAY_EARN, "Bad", "idem-1", null, null, Map.of()));
    assertThrows(IllegalArgumentException.class, () -> new EconomyTransaction(
        UUID.randomUUID(), "Alex", 1, EconomyCategory.SPEND, "Bad", "idem-2", null, null, Map.of()));
  }
}
