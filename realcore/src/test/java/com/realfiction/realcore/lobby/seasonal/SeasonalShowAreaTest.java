package com.realfiction.realcore.lobby.seasonal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.ThreadLocalRandom;
import org.bukkit.Location;
import org.junit.jupiter.api.Test;

/**
 * Locks the containment math that keeps seasonal fireworks/sparkles inside the
 * walkable lobby corridor (z -178..-124) and high enough that a firework blast
 * can never reach a player on the ground.
 */
final class SeasonalShowAreaTest {

  // Anchor placed at one end of the corridor (matches "starting z = -124"),
  // ground at y = 70, to prove pads still spread across the whole corridor.
  private static Location anchor() {
    return new Location(null, 1000.0D, 70.0D, SeasonalShowArea.Z_MAX);
  }

  @Test
  void centerSitsInTheMiddleOfTheCorridor() {
    Location center = SeasonalShowArea.center(anchor());
    assertEquals(-151.0D, center.getZ(), 0.0001D);
    assertEquals(1000.0D, center.getX(), 0.0001D);
    assertEquals(70.0D, center.getY(), 0.0001D);
  }

  @Test
  void clampZKeepsValuesInsideTheCorridor() {
    assertEquals(SeasonalShowArea.Z_MAX, SeasonalShowArea.clampZ(-100.0D), 0.0001D);
    assertEquals(SeasonalShowArea.Z_MIN, SeasonalShowArea.clampZ(-260.0D), 0.0001D);
    assertEquals(-150.0D, SeasonalShowArea.clampZ(-150.0D), 0.0001D);
  }

  @Test
  void fireworkPadsStayInsideTheCorridorAtSafeHeight() {
    Location anchor = anchor();
    ThreadLocalRandom random = ThreadLocalRandom.current();
    for (int i = 0; i < 5000; i++) {
      Location pad = SeasonalShowArea.randomFireworkPad(anchor, random);

      assertTrue(pad.getZ() >= SeasonalShowArea.Z_MIN && pad.getZ() <= SeasonalShowArea.Z_MAX,
          "z out of corridor: " + pad.getZ());
      assertTrue(Math.abs(pad.getX() - anchor.getX()) <= SeasonalShowArea.X_HALF_WIDTH + 1e-6,
          "x outside the lobby width: " + pad.getX());

      double height = pad.getY() - anchor.getY();
      assertTrue(height >= SeasonalShowArea.FIREWORK_HEIGHT_MIN - 1e-6
              && height <= SeasonalShowArea.FIREWORK_HEIGHT_MAX + 1e-6,
          "height outside the safe band: " + height);
      // The whole point: never within firework blast range of the ground.
      assertTrue(height > 5.0D, "firework would be close enough to damage players: " + height);
    }
  }

  @Test
  void centeredRingsStayInsideTheCorridor() {
    // The big-show rings reach a max radius of 15 (10 + (i % 3) * 2.5) around
    // the corridor center. Both extremes must stay within the z bounds.
    double maxRingRadius = 15.0D;
    double center = SeasonalShowArea.centerZ();
    assertTrue(center - maxRingRadius >= SeasonalShowArea.Z_MIN,
        "ring near edge would cross z-min");
    assertTrue(center + maxRingRadius <= SeasonalShowArea.Z_MAX,
        "ring near edge would cross z-max");
  }
}
