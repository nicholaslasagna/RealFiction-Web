package com.realfiction.realcore.lobby.seasonal;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.Month;
import java.time.temporal.TemporalAdjusters;
import java.util.Map;

/** Holiday date helpers for the seasonal event registry. */
public final class HolidayDateRules {
  static final LocalDate US250_START = LocalDate.of(2026, 6, 19);
  static final LocalDate US250_END = LocalDate.of(2026, 7, 9);

  private static final Map<Integer, LocalDate> HANUKKAH_START = Map.of(
      2024, LocalDate.of(2024, 12, 25),
      2025, LocalDate.of(2025, 12, 14),
      2026, LocalDate.of(2026, 12, 4),
      2027, LocalDate.of(2027, 11, 24),
      2028, LocalDate.of(2028, 12, 12)
  );

  private static final Map<Integer, LocalDate> CHINESE_NEW_YEAR = Map.of(
      2024, LocalDate.of(2024, 2, 10),
      2025, LocalDate.of(2025, 1, 29),
      2026, LocalDate.of(2026, 2, 17),
      2027, LocalDate.of(2027, 2, 6),
      2028, LocalDate.of(2028, 1, 26)
  );

  private HolidayDateRules() {
  }

  public static boolean isUs250Window(LocalDate date) {
    return date != null && !date.isBefore(US250_START) && !date.isAfter(US250_END);
  }

  public static LocalDate memorialDay(int year) {
    return LocalDate.of(year, Month.MAY, 1).with(TemporalAdjusters.lastInMonth(DayOfWeek.MONDAY));
  }

  public static LocalDate thanksgiving(int year) {
    return LocalDate.of(year, Month.NOVEMBER, 1)
        .with(TemporalAdjusters.dayOfWeekInMonth(4, DayOfWeek.THURSDAY));
  }

  public static LocalDate easterSunday(int year) {
    int a = year % 19;
    int b = year / 100;
    int c = year % 100;
    int d = b / 4;
    int e = b % 4;
    int f = (b + 8) / 25;
    int g = (b - f + 1) / 3;
    int h = (19 * a + b - d - g + 15) % 30;
    int i = c / 4;
    int k = c % 4;
    int l = (32 + 2 * e + 2 * i - h - k) % 7;
    int m = (a + 11 * h + 22 * l) / 451;
    int month = (h + l - 7 * m + 114) / 31;
    int day = ((h + l - 7 * m + 114) % 31) + 1;
    return LocalDate.of(year, month, day);
  }

  public static LocalDate hanukkahStart(int year) {
    return HANUKKAH_START.get(year);
  }

  public static LocalDate chineseNewYear(int year) {
    return CHINESE_NEW_YEAR.get(year);
  }

  public static boolean independenceDaySuppressed(LocalDate date) {
    return date != null && date.getYear() == 2026 && isUs250Window(date);
  }
}
