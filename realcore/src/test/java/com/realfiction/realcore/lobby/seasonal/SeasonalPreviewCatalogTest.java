package com.realfiction.realcore.lobby.seasonal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

final class SeasonalPreviewCatalogTest {
  @Test
  void previewBypassesCalendarWindow() {
    SeasonalEventRegistry registry = new SeasonalEventRegistry();
    LocalDate offSeason = LocalDate.of(2026, 3, 1);
    assertTrue(registry.activeEvent(offSeason) == null || !"christmas".equals(registry.activeEvent(offSeason).id()));
    assertTrue(SeasonalPreviewCatalog.resolve("christmas").isPresent());
  }

  @Test
  void resolvesAliases() {
    assertEquals("us250_independence_day", SeasonalPreviewCatalog.resolve("us250").orElseThrow().canonicalId());
    assertEquals("us250_midnight", SeasonalPreviewCatalog.resolve("us250_midnight_eastern").orElseThrow().canonicalId());
    assertTrue(SeasonalPreviewCatalog.resolve("us250_midnight").orElseThrow().midnightPreview());
  }

  @Test
  void unknownPreviewIdIsEmpty() {
    assertFalse(SeasonalPreviewCatalog.resolve("not_a_holiday").isPresent());
    assertTrue(SeasonalPreviewCatalog.validIdsMessage().contains("christmas"));
    assertTrue(SeasonalPreviewCatalog.validIdsMessage().contains("halloween"));
  }

  @Test
  void midnightPreviewUsesAmbienceEventWithoutMidnightId() {
    SeasonalPreviewCatalog.PreviewSpec spec = SeasonalPreviewCatalog.resolve("us250_midnight").orElseThrow();
    assertEquals("us250_independence_day", spec.ambienceEventId());
    assertTrue(spec.midnightPreview());
  }
}
