package com.realfiction.realcore.menu;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

final class MenuRegistryTest {
  @Test
  void normalizesMenuSizeToMultiplesOfNine() {
    assertEquals(9, MenuRegistry.normalizeSize(0));
    assertEquals(9, MenuRegistry.normalizeSize(5));
    assertEquals(18, MenuRegistry.normalizeSize(10));
    assertEquals(27, MenuRegistry.normalizeSize(27));
    assertEquals(54, MenuRegistry.normalizeSize(54));
    assertEquals(54, MenuRegistry.normalizeSize(100));
  }
}
