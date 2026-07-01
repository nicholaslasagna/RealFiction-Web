package com.realfiction.realcore.halloween;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Random;
import org.bukkit.util.Vector;
import org.junit.jupiter.api.Test;

/**
 * Window stalk placement must be subtle: candidates biased toward the far half of the
 * configured range with a bounded lateral offset (never dead-centered every time), while the
 * final fallback stays the deterministic legacy centered minimum so tight builds still work.
 */
final class HerobrineWindowStalkOffsetsTest {
  private static final Vector OUT = new Vector(0.0, 0.0, 1.0);

  @Test
  void offsetsStayWithinConfiguredRangeAndFarFirst() {
    for (int seed = 0; seed < 200; seed++) {
      List<Vector> offsets = HerobrineStalkerService.windowOutsideOffsets(OUT, 8, 24, new Random(seed));
      assertEquals(3, offsets.size());
      double farDistance = offsets.get(0).getZ();
      double nearDistance = offsets.get(1).getZ();
      double mid = 8 + (24 - 8) / 2.0;
      assertTrue(farDistance >= mid && farDistance <= 24, "far candidate outside [mid,max]: " + farDistance);
      assertTrue(nearDistance >= 8 && nearDistance <= mid, "near candidate outside [min,mid]: " + nearDistance);
      assertTrue(farDistance >= nearDistance, "far candidate must come first");
    }
  }

  @Test
  void lateralOffsetIsBoundedAndHorizontal() {
    for (int seed = 0; seed < 200; seed++) {
      List<Vector> offsets = HerobrineStalkerService.windowOutsideOffsets(OUT, 8, 24, new Random(seed));
      for (Vector offset : offsets) {
        assertEquals(0.0, offset.getY(), 1.0E-9, "offsets must be horizontal");
        assertTrue(Math.abs(offset.getX()) <= 2.5 + 1.0E-9, "lateral offset out of bounds: " + offset.getX());
      }
    }
  }

  @Test
  void lateralOffsetActuallyVaries() {
    boolean sawOffCenter = false;
    for (int seed = 0; seed < 50 && !sawOffCenter; seed++) {
      List<Vector> offsets = HerobrineStalkerService.windowOutsideOffsets(OUT, 8, 24, new Random(seed));
      sawOffCenter = Math.abs(offsets.get(0).getX()) > 0.5;
    }
    assertTrue(sawOffCenter, "far candidates must not always be centered on the window");
  }

  @Test
  void fallbackIsLegacyCenteredMinimum() {
    List<Vector> offsets = HerobrineStalkerService.windowOutsideOffsets(OUT, 8, 24, new Random(42));
    Vector fallback = offsets.get(2);
    assertEquals(0.0, fallback.getX(), 1.0E-9);
    assertEquals(8.0, fallback.getZ(), 1.0E-9);
  }

  @Test
  void degenerateRangeStillProducesCandidates() {
    List<Vector> offsets = HerobrineStalkerService.windowOutsideOffsets(OUT, 6, 6, new Random(1));
    assertEquals(3, offsets.size());
    for (Vector offset : offsets) {
      assertEquals(6.0, offset.getZ(), 1.0E-9);
    }
  }
}
