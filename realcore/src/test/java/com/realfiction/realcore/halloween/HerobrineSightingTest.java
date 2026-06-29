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
        null);

    assertTrue(sighting.soundCooldownElapsed(10_000L, 10_000L));
    assertFalse(sighting.soundCooldownElapsed(15_000L, 10_000L));
    assertTrue(sighting.soundCooldownElapsed(20_000L, 10_000L));
  }
}
