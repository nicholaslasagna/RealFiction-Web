package com.realfiction.realcore.lobby.seasonal;

import java.time.LocalDate;
import java.time.Month;
import java.time.temporal.ChronoUnit;

/**
 * Computes the lobby time-of-day for the seasonal calendar.
 *
 * <p>The lobby normally sits at <b>noon</b>. As a holiday approaches, the sun
 * slowly slides toward a position that fits the holiday (e.g. deep night for
 * Halloween/New Year's, fireworks night for Independence Day, a cozy snowy
 * evening for Christmas, a golden autumn afternoon for Thanksgiving), reaching
 * that position exactly on the holiday's peak day, then easing back to noon
 * over the days after. Outside any holiday window it stays at noon.
 *
 * <p>Minecraft time ticks: 0 = 6 AM (sunrise), 6000 = noon, 12000 = sunset,
 * 18000 = midnight. The ramp matches the seasonal ambience window
 * ({@link SeasonalEventWindow#aroundHoliday}: 15 days before, 5 days after).
 *
 * <p>Pure date/number logic — no Bukkit — so it's unit tested directly.
 */
public final class SeasonalSkyClock {
  private SeasonalSkyClock() {
  }

  /** Lobby default time of day (noon). */
  public static final long NOON = 6000L;

  /** Ramp window, matching {@link SeasonalEventWindow#aroundHoliday}. */
  public static final int DAYS_BEFORE = 15;
  public static final int DAYS_AFTER = 5;

  /**
   * The time of day a holiday's sun settles at on its peak day. Themes not
   * listed (and {@code NONE}) keep noon, so their ramp is a no-op.
   */
  public static long targetTickFor(SeasonalAmbienceTheme theme) {
    if (theme == null) {
      return NOON;
    }
    return switch (theme) {
      case NEW_YEARS -> 18000L;            // midnight — literally midnight
      case HALLOWEEN -> 17500L;            // deep night, moon high (spooky)
      case US250_INDEPENDENCE_DAY, INDEPENDENCE_DAY -> 15000L; // night for fireworks
      case CHINESE_NEW_YEAR -> 14000L;     // night — lanterns + fireworks
      case CHRISTMAS, HANUKKAH -> 13800L;  // cozy evening (candles / snow)
      case VALENTINES_DAY -> 13000L;       // romantic dusk
      case THANKSGIVING -> 11500L;         // warm golden autumn afternoon
      case MEMORIAL_DAY, VETERANS_DAY -> 11000L; // solemn late afternoon
      case EASTER -> 1200L;                // bright spring morning
      default -> NOON;
    };
  }

  /** Peak calendar day of a theme for a given year, or {@code null}. */
  public static LocalDate peakDay(SeasonalAmbienceTheme theme, int year) {
    if (theme == null) {
      return null;
    }
    return switch (theme) {
      case US250_INDEPENDENCE_DAY, INDEPENDENCE_DAY -> LocalDate.of(year, Month.JULY, 4);
      case HALLOWEEN -> LocalDate.of(year, Month.OCTOBER, 31);
      case CHRISTMAS -> LocalDate.of(year, Month.DECEMBER, 25);
      case NEW_YEARS -> LocalDate.of(year, Month.JANUARY, 1);
      case VALENTINES_DAY -> LocalDate.of(year, Month.FEBRUARY, 14);
      case VETERANS_DAY -> LocalDate.of(year, Month.NOVEMBER, 11);
      case MEMORIAL_DAY -> HolidayDateRules.memorialDay(year);
      case THANKSGIVING -> HolidayDateRules.thanksgiving(year);
      case EASTER -> HolidayDateRules.easterSunday(year);
      case HANUKKAH -> HolidayDateRules.hanukkahStart(year);
      case CHINESE_NEW_YEAR -> HolidayDateRules.chineseNewYear(year);
      default -> null;
    };
  }

  /**
   * Nearest occurrence of a theme's peak to {@code today}, checking the
   * previous/current/next year so windows that straddle the year boundary
   * (New Year's, Christmas) resolve correctly.
   */
  static LocalDate nearestPeak(SeasonalAmbienceTheme theme, LocalDate today) {
    LocalDate best = null;
    long bestDistance = Long.MAX_VALUE;
    for (int year = today.getYear() - 1; year <= today.getYear() + 1; year++) {
      LocalDate candidate = peakDay(theme, year);
      if (candidate == null) {
        continue;
      }
      long distance = Math.abs(ChronoUnit.DAYS.between(today, candidate));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best;
  }

  /**
   * The lobby time of day for {@code today}: noon outside the window, ramping
   * to the theme's target on the peak day and back to noon afterward.
   */
  public static long targetTime(SeasonalAmbienceTheme theme, LocalDate today) {
    long target = targetTickFor(theme);
    if (target == NOON || today == null) {
      return NOON;
    }
    LocalDate peak = nearestPeak(theme, today);
    if (peak == null) {
      return NOON;
    }
    long daysFromPeak = ChronoUnit.DAYS.between(peak, today); // <0 before, >0 after
    double progress;
    if (daysFromPeak <= 0) {
      progress = 1.0D + (daysFromPeak / (double) DAYS_BEFORE);
    } else {
      progress = 1.0D - (daysFromPeak / (double) DAYS_AFTER);
    }
    if (progress <= 0.0D) {
      return NOON; // outside the ramp window
    }
    progress = Math.min(1.0D, progress);
    return Math.round(NOON + (target - NOON) * progress);
  }

  /**
   * Full holiday sky for a theme, ignoring the date ramp — used by the admin
   * preview so {@code /rf seasonal preview <holiday>} shows the holiday's sky
   * immediately even when the real date is months away.
   */
  public static long previewTime(SeasonalAmbienceTheme theme) {
    return targetTickFor(theme);
  }
}
