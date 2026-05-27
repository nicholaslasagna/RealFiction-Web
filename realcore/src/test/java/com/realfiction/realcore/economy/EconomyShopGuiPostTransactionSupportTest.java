package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

final class EconomyShopGuiPostTransactionSupportTest {

  @Test
  void dollarsToMinorRejectsInvalidValues() {
    assertEquals(0, EconomyShopGuiPostTransactionSupport.dollarsToMinor(Double.NaN));
    assertEquals(0, EconomyShopGuiPostTransactionSupport.dollarsToMinor(-1));
    assertEquals(100, EconomyShopGuiPostTransactionSupport.dollarsToMinor(1.0));
  }

  @Test
  void dollarsToMinorCapsExtremeAmounts() {
    assertEquals(
        EconomyShopGuiPostTransactionSupport.MAX_VAULT_AMOUNT_MINOR,
        EconomyShopGuiPostTransactionSupport.dollarsToMinor(1.0e15)
    );
  }
}
