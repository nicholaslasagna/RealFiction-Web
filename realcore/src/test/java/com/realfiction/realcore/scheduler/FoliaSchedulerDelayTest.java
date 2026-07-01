package com.realfiction.realcore.scheduler;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/**
 * Folia's runDelayed rejects delay <= 0 ("Delay ticks may not be <= 0"), which crashed the
 * distant-omen particle loop whose first pulse scheduled at delay 0. Every delayed dispatch
 * must clamp to at least one tick.
 */
final class FoliaSchedulerDelayTest {
  @Test
  void zeroDelayBecomesOneTick() {
    assertEquals(1L, FoliaScheduler.delayedTicks(0L));
  }

  @Test
  void negativeDelayBecomesOneTick() {
    assertEquals(1L, FoliaScheduler.delayedTicks(-5L));
  }

  @Test
  void positiveDelayUnchanged() {
    assertEquals(7L, FoliaScheduler.delayedTicks(7L));
  }
}
