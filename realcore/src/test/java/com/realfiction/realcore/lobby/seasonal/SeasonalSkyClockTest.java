package com.realfiction.realcore.lobby.seasonal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import java.time.Month;
import org.junit.jupiter.api.Test;

/**
 * Locks the lobby sky clock: noon by default, ramping to a holiday's sun
 * position on its peak day and back to noon outside the window.
 */
final class SeasonalSkyClockTest {

  @Test
  void noonFarFromAnyHoliday() {
    assertEquals(SeasonalSkyClock.NOON,
        SeasonalSkyClock.targetTime(SeasonalAmbienceTheme.HALLOWEEN, LocalDate.of(2026, Month.MARCH, 1)));
  }

  @Test
  void peakDayHitsTheHolidayTime() {
    assertEquals(17500L,
        SeasonalSkyClock.targetTime(SeasonalAmbienceTheme.HALLOWEEN, LocalDate.of(2026, Month.OCTOBER, 31)));
    assertEquals(18000L,
        SeasonalSkyClock.targetTime(SeasonalAmbienceTheme.NEW_YEARS, LocalDate.of(2026, Month.JANUARY, 1)));
    assertEquals(13800L,
        SeasonalSkyClock.targetTime(SeasonalAmbienceTheme.CHRISTMAS, LocalDate.of(2026, Month.DECEMBER, 25)));
    assertEquals(15000L,
        SeasonalSkyClock.targetTime(SeasonalAmbienceTheme.US250_INDEPENDENCE_DAY, LocalDate.of(2026, Month.JULY, 4)));
  }

  @Test
  void windowEdgesAreNoon() {
    // 15 days before and 5 days after Halloween are the ramp boundaries.
    assertEquals(SeasonalSkyClock.NOON,
        SeasonalSkyClock.targetTime(SeasonalAmbienceTheme.HALLOWEEN, LocalDate.of(2026, Month.OCTOBER, 16)));
    assertEquals(SeasonalSkyClock.NOON,
        SeasonalSkyClock.targetTime(SeasonalAmbienceTheme.HALLOWEEN, LocalDate.of(2026, Month.NOVEMBER, 5)));
  }

  @Test
  void rampClimbsTowardTheHolidayAsItApproaches() {
    long noon = SeasonalSkyClock.NOON;
    long target = 17500L;
    long twelveBefore = SeasonalSkyClock.targetTime(SeasonalAmbienceTheme.HALLOWEEN, LocalDate.of(2026, Month.OCTOBER, 19));
    long sevenBefore = SeasonalSkyClock.targetTime(SeasonalAmbienceTheme.HALLOWEEN, LocalDate.of(2026, Month.OCTOBER, 24));
    long oneBefore = SeasonalSkyClock.targetTime(SeasonalAmbienceTheme.HALLOWEEN, LocalDate.of(2026, Month.OCTOBER, 30));

    assertTrue(noon < twelveBefore, "should have started moving past noon");
    assertTrue(twelveBefore < sevenBefore, "should keep climbing as it gets closer");
    assertTrue(sevenBefore < oneBefore, "should be near the target the day before");
    assertTrue(oneBefore < target, "but not reach the full target until the peak day");
  }

  @Test
  void unlistedThemesAndNoneStayNoon() {
    assertEquals(SeasonalSkyClock.NOON,
        SeasonalSkyClock.targetTime(SeasonalAmbienceTheme.NONE, LocalDate.of(2026, Month.JULY, 1)));
    assertEquals(SeasonalSkyClock.NOON, SeasonalSkyClock.targetTickFor(SeasonalAmbienceTheme.NONE));
  }

  @Test
  void newYearWindowResolvesAcrossTheYearBoundary() {
    // Late December should already be ramping toward the Jan 1 midnight.
    long lateDec = SeasonalSkyClock.targetTime(SeasonalAmbienceTheme.NEW_YEARS, LocalDate.of(2026, Month.DECEMBER, 28));
    assertTrue(lateDec > SeasonalSkyClock.NOON && lateDec <= 18000L,
        "late December should be ramping toward midnight: " + lateDec);
    assertEquals(18000L,
        SeasonalSkyClock.targetTime(SeasonalAmbienceTheme.NEW_YEARS, LocalDate.of(2027, Month.JANUARY, 1)));
  }

  @Test
  void previewShowsFullHolidaySkyRegardlessOfDate() {
    assertEquals(13800L, SeasonalSkyClock.previewTime(SeasonalAmbienceTheme.CHRISTMAS));
    assertEquals(17500L, SeasonalSkyClock.previewTime(SeasonalAmbienceTheme.HALLOWEEN));
  }
}
