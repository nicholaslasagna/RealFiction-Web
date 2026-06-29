package com.realfiction.realcore.halloween;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

final class HalloweenEventWindowTest {
  @Test
  void defaultWindowIsInclusiveOctoberFifteenthThroughNovemberFirst() {
    HalloweenEventWindow window = HalloweenEventWindow.defaultWindow();

    assertFalse(window.contains(LocalDate.of(2026, 10, 14)));
    assertTrue(window.contains(LocalDate.of(2026, 10, 15)));
    assertTrue(window.contains(LocalDate.of(2026, 10, 31)));
    assertTrue(window.contains(LocalDate.of(2026, 11, 1)));
    assertFalse(window.contains(LocalDate.of(2026, 11, 2)));
  }

  @Test
  void supportsWindowsThatCrossNewYear() {
    HalloweenEventWindow window = new HalloweenEventWindow(12, 20, 1, 5);

    assertTrue(window.contains(LocalDate.of(2026, 12, 24)));
    assertTrue(window.contains(LocalDate.of(2027, 1, 1)));
    assertFalse(window.contains(LocalDate.of(2027, 1, 6)));
    assertFalse(window.contains(LocalDate.of(2026, 12, 19)));
  }
}
