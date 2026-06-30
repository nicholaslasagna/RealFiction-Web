package com.realfiction.realcore.halloween;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class HerobrineSightingTest {
  @Test
  void vanishingFlagOnlyTransitionsOnce() {
    HerobrineSighting sighting = new HerobrineSighting(
        UUID.randomUUID(),
        UUID.randomUUID(),
        "Player",
        UUID.randomUUID(),
        Instant.now(),
        Instant.now().plusSeconds(8),
        false,
        false,
        null);

    assertFalse(sighting.vanishing());
    assertTrue(sighting.markVanishing());
    assertTrue(sighting.vanishing());
    assertFalse(sighting.markVanishing());
  }

  @Test
  void soundCooldownPreventsSpam() {
    HerobrineSighting sighting = new HerobrineSighting(
        UUID.randomUUID(),
        UUID.randomUUID(),
        "Player",
        UUID.randomUUID(),
        Instant.now(),
        Instant.now().plusSeconds(8),
        false,
        false,
        null);

    assertTrue(sighting.soundCooldownElapsed(10_000L, 10_000L));
    assertFalse(sighting.soundCooldownElapsed(15_000L, 10_000L));
    assertTrue(sighting.soundCooldownElapsed(20_000L, 10_000L));
  }

  @Test
  void silhouetteAndMarkerFlagsAreStable() {
    HerobrineSighting sighting = new HerobrineSighting(
        UUID.randomUUID(),
        UUID.randomUUID(),
        "Player",
        UUID.randomUUID(),
        Instant.now(),
        Instant.now().plusSeconds(2),
        false,
        true,
        null);

    assertTrue(sighting.silhouette());
    assertTrue(sighting.markOmenMarkerScheduled());
    assertFalse(sighting.markOmenMarkerScheduled());
  }

  @Test
  void proximityTimerCanBeClearedAfterPlayerMovesAway() {
    HerobrineSighting sighting = new HerobrineSighting(
        UUID.randomUUID(),
        UUID.randomUUID(),
        "Player",
        UUID.randomUUID(),
        Instant.now(),
        Instant.now().plusSeconds(8),
        false,
        false,
        null);
    Instant entered = Instant.parse("2026-10-20T05:00:00Z");

    sighting.markProximityEnteredAt(entered);

    assertTrue(entered.equals(sighting.proximityEnteredAt()));
    sighting.clearProximityEnteredAt();
    assertTrue(sighting.proximityEnteredAt() == null);
  }
}
