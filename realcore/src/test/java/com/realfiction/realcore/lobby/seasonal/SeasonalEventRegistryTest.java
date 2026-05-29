package com.realfiction.realcore.lobby.seasonal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

final class SeasonalEventRegistryTest {
  private final SeasonalEventRegistry registry = new SeasonalEventRegistry();

  @Test
  void us250ActiveAcrossSpecialWindow() {
    assertEquals("us250_independence_day", registry.activeEvent(LocalDate.of(2026, 6, 19)).id());
    assertEquals("us250_independence_day", registry.activeEvent(LocalDate.of(2026, 7, 4)).id());
    assertEquals("us250_independence_day", registry.activeEvent(LocalDate.of(2026, 7, 9)).id());
  }

  @Test
  void julyFourth2026UsesUs250NotIndependenceDay() {
    SeasonalEventDefinition active = registry.activeEvent(LocalDate.of(2026, 7, 4));
    assertNotNull(active);
    assertEquals("us250_independence_day", active.id());
    SeasonalEventDefinition independence = registry.byId("independence_day").orElseThrow();
    assertFalse(independence.isActiveOn(LocalDate.of(2026, 7, 4)));
  }

  @Test
  void julyFourth2025UsesIndependenceDay() {
    SeasonalEventDefinition active = registry.activeEvent(LocalDate.of(2025, 7, 4));
    assertNotNull(active);
    assertEquals("independence_day", active.id());
  }

  @Test
  void outsideUs250WindowReturnsNullOnRandomDate() {
    assertNull(registry.activeEvent(LocalDate.of(2026, 8, 1)));
  }
}
