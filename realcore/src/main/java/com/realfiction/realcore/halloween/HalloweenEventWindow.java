package com.realfiction.realcore.halloween;

import java.time.LocalDate;
import java.time.MonthDay;

/** Inclusive month/day event window, with support for windows crossing New Year. */
public record HalloweenEventWindow(int startMonth, int startDay, int endMonth, int endDay) {
  public HalloweenEventWindow {
    validate(startMonth, startDay);
    validate(endMonth, endDay);
  }

  public boolean contains(LocalDate date) {
    if (date == null) {
      return false;
    }
    MonthDay start = MonthDay.of(startMonth, startDay);
    MonthDay end = MonthDay.of(endMonth, endDay);
    MonthDay current = MonthDay.from(date);
    if (start.compareTo(end) <= 0) {
      return current.compareTo(start) >= 0 && current.compareTo(end) <= 0;
    }
    return current.compareTo(start) >= 0 || current.compareTo(end) <= 0;
  }

  public String summary() {
    return startMonth + "/" + startDay + "-" + endMonth + "/" + endDay;
  }

  public static HalloweenEventWindow defaultWindow() {
    return new HalloweenEventWindow(10, 15, 11, 1);
  }

  private static void validate(int month, int day) {
    MonthDay.of(month, day);
  }
}
