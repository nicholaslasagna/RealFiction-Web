package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

final class VaultBalanceSyncServiceTest {
  @Test
  void convertsVaultDollarsToMinorUnits() {
    assertEquals(0, VaultBalanceSyncService.toMinorUnits(0.0, 100));
    assertEquals(100, VaultBalanceSyncService.toMinorUnits(1.0, 100));
    assertEquals(25075, VaultBalanceSyncService.toMinorUnits(250.75, 100));
    assertEquals(251, VaultBalanceSyncService.toMinorUnits(2.505, 100));
  }

  @Test
  void convertsMinorUnitsToVaultAmount() {
    assertEquals(1.0, VaultBalanceSyncService.toVaultAmount(100, 100));
    assertEquals(250.75, VaultBalanceSyncService.toVaultAmount(25075, 100));
    assertEquals(0.01, VaultBalanceSyncService.toVaultAmount(1, 100));
  }

  @Test
  void formatsMinorUnitBalancesForOperatorOutput() {
    assertEquals("$0.00", EconomyBalanceFormat.formatMinor(0, 100));
    assertEquals("$1.00", EconomyBalanceFormat.formatMinor(100, 100));
    assertEquals("$250.75", EconomyBalanceFormat.formatMinor(25075, 100));
    assertEquals("$-1.25", EconomyBalanceFormat.formatMinor(-125, 100));
    assertEquals("$-0.25", EconomyBalanceFormat.formatMinor(-25, 100));
  }
}
