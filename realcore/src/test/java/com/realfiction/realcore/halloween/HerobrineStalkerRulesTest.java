package com.realfiction.realcore.halloween;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.time.Instant;
import org.bukkit.Material;
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
    assertEquals(0.0, HerobrineStalkerRules.clampChance(-1.0), 0.0001);
    assertEquals(1.0, HerobrineStalkerRules.clampChance(5.0), 0.0001);
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

  @Test
  void configuredViewConeDetectsDirectLookButRejectsOutsideCone() {
    Vector eye = new Vector(0, 64, 0);
    Vector direction = new Vector(0, 0, 1);
    double normalDot = HerobrineStalkerRules.dotForViewDegrees(32.0);

    assertTrue(HerobrineStalkerRules.directLook(eye, direction, new Vector(0, 65, 20), 64, normalDot));
    assertFalse(HerobrineStalkerRules.directLook(eye, direction, new Vector(20, 65, 20), 64, normalDot));
  }

  @Test
  void miningIntentWiderConeDetectsRoughCameraSweep() {
    Vector eye = new Vector(0, 64, 0);
    Vector direction = new Vector(0, 0, 1);
    Vector roughTarget = new Vector(18, 65, 20);

    assertFalse(HerobrineStalkerRules.directLook(
        eye,
        direction,
        roughTarget,
        64,
        HerobrineStalkerRules.dotForViewDegrees(32.0)
    ));
    assertTrue(HerobrineStalkerRules.directLook(
        eye,
        direction,
        roughTarget,
        64,
        HerobrineStalkerRules.dotForViewDegrees(52.0)
    ));
  }

  @Test
  void proximityRequiresRadiusAndSustainedTime() {
    Instant now = Instant.parse("2026-10-20T05:00:00Z");

    assertFalse(HerobrineStalkerRules.insideRadius(25.0, 4.0));
    assertTrue(HerobrineStalkerRules.insideRadius(16.0, 4.0));
    assertFalse(HerobrineStalkerRules.sustainedFor(now, now.minusMillis(900), Duration.ofSeconds(1)));
    assertTrue(HerobrineStalkerRules.sustainedFor(now, now.minusSeconds(1), Duration.ofSeconds(1)));
    assertFalse(HerobrineStalkerRules.cooldownElapsed(now, now.minusSeconds(119), Duration.ofSeconds(120)));
    assertTrue(HerobrineStalkerRules.cooldownElapsed(now, now.minusSeconds(120), Duration.ofSeconds(120)));
  }

  @Test
  void windowStalkRequiresConfiguredDarkAndRainGates() {
    HerobrineWindowStalkConfig config = HerobrineWindowStalkConfig.defaults();

    assertFalse(HerobrineStalkerRules.windowStalkWeatherAllowed(false, true, config));
    assertFalse(HerobrineStalkerRules.windowStalkWeatherAllowed(true, false, config));
    assertTrue(HerobrineStalkerRules.windowStalkWeatherAllowed(true, true, config));
  }

  @Test
  void glassAndBaseLikeMaterialsAreConservative() {
    assertTrue(HerobrineStalkerRules.glassLike(Material.GLASS));
    assertTrue(HerobrineStalkerRules.glassLike(Material.GLASS_PANE));
    assertTrue(HerobrineStalkerRules.glassLike(Material.BLACK_STAINED_GLASS));
    assertFalse(HerobrineStalkerRules.glassLike(Material.STONE));

    assertTrue(HerobrineStalkerRules.baseLikeBlock(Material.CHEST));
    assertTrue(HerobrineStalkerRules.baseLikeBlock(Material.OAK_DOOR));
    assertTrue(HerobrineStalkerRules.baseLikeBlock(Material.FARMLAND));
    assertTrue(HerobrineStalkerRules.baseLikeBlock(Material.WHEAT));
    assertTrue(HerobrineStalkerRules.baseLikeBlock(Material.REDSTONE_WIRE));
    assertTrue(HerobrineStalkerRules.baseLikeBlock(Material.GLASS));
    assertFalse(HerobrineStalkerRules.baseLikeBlock(Material.STONE));
    assertFalse(HerobrineStalkerRules.baseLikeBlock(Material.DIRT));
  }
}
