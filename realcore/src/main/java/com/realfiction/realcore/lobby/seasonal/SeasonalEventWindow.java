package com.realfiction.realcore.lobby.seasonal;

import java.time.LocalDate;

/** Inclusive calendar window for a seasonal event. */
public record SeasonalEventWindow(LocalDate start, LocalDate end) {
  public SeasonalEventWindow {
    if (start == null || end == null) {
      throw new IllegalArgumentException("Seasonal window dates are required");
    }
    if (end.isBefore(start)) {
      throw new IllegalArgumentException("Seasonal window end must be on or after start");
    }
  }

  public boolean contains(LocalDate date) {
    if (date == null) {
      return false;
    }
    return !date.isBefore(start) && !date.isAfter(end);
  }

  /** 15 days before through 5 days after the holiday date (inclusive). */
  public static SeasonalEventWindow aroundHoliday(LocalDate holiday) {
    return new SeasonalEventWindow(holiday.minusDays(15), holiday.plusDays(5));
  }
}
