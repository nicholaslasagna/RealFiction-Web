package com.realfiction.realcore.halloween;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.time.Instant;
import org.bukkit.util.Vector;
import org.junit.jupiter.api.Test;

final class HerobrineStalkerRulesTest {
  @Test
  void requiresAtLeastOneSpookyConditionWhenConfigured() {
    assertFalse(HerobrineStalkerRules.qualifies(new SpookyConditions(false, false, false, false), true));
    assertTrue(HerobrineStalkerRules.qualifies(new SpookyConditions(true, false, false, false), true));
    assertTrue(HerobrineStalkerRules.qualifies(new SpookyConditions(false, false, false, false), false));
  }

  @Test
  void cooldownPreventsRepeatedSightings() {
    Instant now = Instant.parse("2026-10-20T05:00:00Z");
    Instant last = now.minusSeconds(599);

    assertFalse(HerobrineStalkerRules.cooldownElapsed(now, last, Duration.ofSeconds(600)));
    assertTrue(HerobrineStalkerRules.cooldownElapsed(now, now.minusSeconds(600), Duration.ofSeconds(600)));
    assertTrue(HerobrineStalkerRules.cooldownElapsed(now, null, Duration.ofSeconds(600)));
  }

  @Test
  void directLookRequiresDistanceAndDotProduct() {
    Vector eye = new Vector(0, 64, 0);
    Vector direction = new Vector(0, 0, 1);

    assertTrue(HerobrineStalkerRules.directLook(eye, direction, new Vector(0, 65, 20), 48, 0.95));
    assertFalse(HerobrineStalkerRules.directLook(eye, direction, new Vector(20, 65, 0), 48, 0.95));
    assertFalse(HerobrineStalkerRules.directLook(eye, direction, new Vector(0, 65, 80), 48, 0.95));
  }

  @Test
  void chanceGateIsDeterministicForGivenRandomValue() {
    assertTrue(HerobrineStalkerRules.shouldAttempt(0.01, 0.015));
    assertFalse(HerobrineStalkerRules.shouldAttempt(0.02, 0.015));
    assertFalse(HerobrineStalkerRules.shouldAttempt(0.0, 0.0));
  }

  @Test
  void activeCapPreventsMassSightings() {
    assertTrue(HerobrineStalkerRules.activeBelowLimit(0, 2));
    assertTrue(HerobrineStalkerRules.activeBelowLimit(1, 2));
    assertFalse(HerobrineStalkerRules.activeBelowLimit(2, 2));
    assertFalse(HerobrineStalkerRules.activeBelowLimit(1, 0));
  }

  @Test
  void miningIntentOnlyBoostsMiningOrCaveConditions() {
    HerobrineMiningIntentConfig miningIntent = HerobrineMiningIntentConfig.defaults();

    assertFalse(HerobrineStalkerRules.miningIntentEligible(new SpookyConditions(true, false, false, false)));
    assertTrue(HerobrineStalkerRules.miningIntentEligible(new SpookyConditions(false, false, true, false)));
    assertTrue(HerobrineStalkerRules.miningIntentEligible(new SpookyConditions(false, false, false, true)));
    assertEquals(0.015, HerobrineStalkerRules.effectiveChance(
        0.015,
        new SpookyConditions(true, false, false, false),
        miningIntent
    ), 0.0001);
    assertEquals(0.0225, HerobrineStalkerRules.effectiveChance(
        0.015,
        new SpookyConditions(false, false, true, false),
        miningIntent
    ), 0.0001);
  }

  @Test
  void viewDegreesConvertToDotThreshold() {
    assertEquals(Math.cos(Math.toRadians(42.0)), HerobrineStalkerRules.dotForViewDegrees(42.0), 0.0001);
    assertEquals(Math.cos(Math.toRadians(1.0)), HerobrineStalkerRules.dotForViewDegrees(-5.0), 0.0001);
    assertEquals(Math.cos(Math.toRadians(179.0)), HerobrineStalkerRules.dotForViewDegrees(500.0), 0.0001);
  }
}
