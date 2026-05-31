package com.realfiction.realcore.lobby.seasonal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.ThreadLocalRandom;
import org.bukkit.Location;
import org.junit.jupiter.api.Test;

/**
 * Locks the containment math that keeps every seasonal effect within
 * {@link SeasonalShowArea#SPAWN_RADIUS} blocks of the spawn point, inside the
 * walkable corridor (z -178..-124), and high enough that a firework blast can
 * never reach a player on the ground.
 */
final class SeasonalShowAreaTest {

  // Anchor at the spawn end of the corridor (matches "starting z = -124"),
  // ground at y = 70.
  private static Location anchor() {
    return new Location(null, 1000.0D, 70.0D, SeasonalShowArea.Z_MAX);
  }

  @Test
  void centerSitsJustInFrontOfSpawn() {
    Location center = SeasonalShowArea.center(anchor());
    // SHOW_FORWARD blocks into the corridor (toward Z_MIN) from spawn.
    assertEquals(SeasonalShowArea.Z_MAX - SeasonalShowArea.SHOW_FORWARD, center.getZ(), 0.0001D);
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
  void fireworkPadsStayNearSpawnInsideTheCorridorAtSafeHeight() {
    Location anchor = anchor();
    Location center = SeasonalShowArea.center(anchor);
    ThreadLocalRandom random = ThreadLocalRandom.current();
    for (int i = 0; i < 5000; i++) {
      Location pad = SeasonalShowArea.randomFireworkPad(anchor, random);

      // Inside the show disc (within SHOW_RADIUS of the forward show center).
      double dx = pad.getX() - center.getX();
      double dz = pad.getZ() - center.getZ();
      assertTrue(Math.hypot(dx, dz) <= SeasonalShowArea.SHOW_RADIUS + 1e-6,
          "pad outside the show disc: dist=" + Math.hypot(dx, dz));

      // The requirement: every pad stays within SPAWN_RADIUS of the spawn point.
      double sdx = pad.getX() - anchor.getX();
      double sdz = pad.getZ() - anchor.getZ();
      assertTrue(Math.hypot(sdx, sdz) <= SeasonalShowArea.SPAWN_RADIUS + 1e-6,
          "pad more than SPAWN_RADIUS from spawn: dist=" + Math.hypot(sdx, sdz));

      // And always inside the walkable corridor on Z.
      assertTrue(pad.getZ() >= SeasonalShowArea.Z_MIN && pad.getZ() <= SeasonalShowArea.Z_MAX,
          "z out of corridor: " + pad.getZ());

      double height = pad.getY() - anchor.getY();
      assertTrue(height >= SeasonalShowArea.FIREWORK_HEIGHT_MIN - 1e-6
              && height <= SeasonalShowArea.FIREWORK_HEIGHT_MAX + 1e-6,
          "height outside the safe band: " + height);
      // The whole point: never within firework blast range of the ground.
      assertTrue(height > 5.0D, "firework would be close enough to damage players: " + height);
    }
  }

  @Test
  void centeredRingsStayNearSpawnInsideTheCorridor() {
    // Big-show rings reach a max radius of 15 (10 + (i % 3) * 2.5) around the
    // forward show center.
    double maxRingRadius = 15.0D;
    Location center = SeasonalShowArea.center(anchor());
    assertTrue(maxRingRadius <= SeasonalShowArea.SHOW_RADIUS, "rings exceed the show disc");
    // Ring edges stay inside the corridor...
    assertTrue(center.getZ() - maxRingRadius >= SeasonalShowArea.Z_MIN,
        "ring near edge would cross z-min");
    assertTrue(center.getZ() + maxRingRadius <= SeasonalShowArea.Z_MAX,
        "ring near edge would cross z-max");
    // ...and the whole ring stays within SPAWN_RADIUS of spawn.
    assertTrue(SeasonalShowArea.SHOW_FORWARD + maxRingRadius <= SeasonalShowArea.SPAWN_RADIUS,
        "rings exceed the spawn radius");
  }
}
