package com.realfiction.realcore.lobby.seasonal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

final class SeasonalAmbienceBudgetTest {
  @Test
  void particleBudgetScalesWithPlayersAndCaps() {
    assertEquals(0, SeasonalAmbienceBudget.particleBudget(0));
    assertEquals(8, SeasonalAmbienceBudget.particleBudget(1));
    assertEquals(24, SeasonalAmbienceBudget.particleBudget(20));
    assertEquals(24, SeasonalAmbienceBudget.particleBudget(100));
  }

  @Test
  void doesNotExceedMaxBurstBudget() {
    assertTrue(SeasonalAmbienceBudget.particleBudget(50) <= SeasonalAmbienceBudget.MAX_PARTICLES_PER_BURST);
  }

  @Test
  void soundOnlyWhenPlayersPresent() {
    assertFalse(SeasonalAmbienceBudget.shouldPlaySound(0));
    assertTrue(SeasonalAmbienceBudget.shouldPlaySound(1));
  }
}
