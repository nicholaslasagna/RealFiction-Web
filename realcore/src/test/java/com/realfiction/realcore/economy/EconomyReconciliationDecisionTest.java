package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.economy.EconomyReconciliationService.Action;
import com.realfiction.realcore.economy.EconomyReconciliationService.Decision;
import org.junit.jupiter.api.Test;

/**
 * Exercises the pure DB-to-Vault reconciliation decision logic across every branch.
 *
 * <p>The invariants under test: it never withdraws money the DB doesn't account for unless the
 * local balance has not risen since our last sync (so a withdraw can only ever undo a spend that
 * happened on another server), it always catches a player up to money earned elsewhere, it holds
 * (never erases) local income that rose since the last sync, it is conservative on cold start, and
 * it refuses moves larger than the configured cap.
 */
final class EconomyReconciliationDecisionTest {
  private static final long CAP = 1_000_000L; // generous default-style cap for most cases

  @Test
  void depositsWhenPlayerEarnedOnAnotherServer() {
    Decision decision = EconomyReconciliationService.decide(true, 1_000, 1_000, 1_500, CAP);
    assertEquals(Action.DEPOSIT, decision.action());
    assertEquals(500, decision.vaultDeltaMinor());
    assertTrue(decision.baselineChanged());
    assertEquals(1_500, decision.newBaselineMinor());
  }

  @Test
  void withdrawsWhenPlayerSpentOnAnotherServer() {
    // Local has not risen since last sync (local == baseline), so the gap is the DB dropping.
    Decision decision = EconomyReconciliationService.decide(true, 1_000, 1_000, 700, CAP);
    assertEquals(Action.WITHDRAW, decision.action());
    assertEquals(300, decision.vaultDeltaMinor());
    assertTrue(decision.baselineChanged());
    assertEquals(700, decision.newBaselineMinor());
  }

  @Test
  void holdsWhenLocalRoseSinceLastSync() {
    // Local rose above baseline (recent captured income not yet flushed, or un-captured /pay):
    // never withdraw it away.
    Decision decision = EconomyReconciliationService.decide(true, 1_000, 1_050, 1_000, CAP);
    assertEquals(Action.HOLD, decision.action());
    assertEquals(0, decision.vaultDeltaMinor());
    assertFalse(decision.baselineChanged());
  }

  @Test
  void noopWhenAlreadyMatchingDb() {
    Decision decision = EconomyReconciliationService.decide(true, 1_000, 1_000, 1_000, CAP);
    assertEquals(Action.NOOP, decision.action());
    assertEquals(0, decision.vaultDeltaMinor());
    assertTrue(decision.baselineChanged());
    assertEquals(1_000, decision.newBaselineMinor());
  }

  @Test
  void coldStartDepositsUpToDb() {
    Decision decision = EconomyReconciliationService.decide(false, 0, 200, 500, CAP);
    assertEquals(Action.DEPOSIT, decision.action());
    assertEquals(300, decision.vaultDeltaMinor());
    assertTrue(decision.baselineChanged());
    assertEquals(500, decision.newBaselineMinor());
  }

  @Test
  void coldStartNeverWithdrawsOnFirstSight() {
    // DB is lower than local but we have no baseline yet: hold, record baseline = local, no change.
    Decision decision = EconomyReconciliationService.decide(false, 0, 900, 500, CAP);
    assertEquals(Action.HOLD, decision.action());
    assertEquals(0, decision.vaultDeltaMinor());
    assertTrue(decision.baselineChanged());
    assertEquals(900, decision.newBaselineMinor());
  }

  @Test
  void coldStartNoopWhenEqual() {
    Decision decision = EconomyReconciliationService.decide(false, 0, 500, 500, CAP);
    assertEquals(Action.NOOP, decision.action());
    assertTrue(decision.baselineChanged());
    assertEquals(500, decision.newBaselineMinor());
  }

  @Test
  void skipsDepositLargerThanCap() {
    Decision decision = EconomyReconciliationService.decide(true, 0, 0, 10_000_000, CAP);
    assertEquals(Action.SKIP_CAP, decision.action());
    assertEquals(0, decision.vaultDeltaMinor());
    assertFalse(decision.baselineChanged());
  }

  @Test
  void skipsWithdrawLargerThanCap() {
    Decision decision = EconomyReconciliationService.decide(true, 10_000_000, 10_000_000, 0, CAP);
    assertEquals(Action.SKIP_CAP, decision.action());
    assertEquals(0, decision.vaultDeltaMinor());
    assertFalse(decision.baselineChanged());
  }

  @Test
  void coldStartSkipsOverCapDepositButRecordsBaseline() {
    Decision decision = EconomyReconciliationService.decide(false, 0, 0, 10_000_000, CAP);
    assertEquals(Action.SKIP_CAP, decision.action());
    assertEquals(0, decision.vaultDeltaMinor());
    // Records baseline = local so subsequent runs are no longer treated as cold start.
    assertTrue(decision.baselineChanged());
    assertEquals(0, decision.newBaselineMinor());
  }

  @Test
  void exactlyAtCapIsAllowed() {
    Decision decision = EconomyReconciliationService.decide(true, 0, 0, CAP, CAP);
    assertEquals(Action.DEPOSIT, decision.action());
    assertEquals(CAP, decision.vaultDeltaMinor());
  }
}
