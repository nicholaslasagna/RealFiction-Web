package com.realfiction.realcore.lobby.seasonal;

import java.time.LocalDate;
import java.util.function.Predicate;

/** One seasonal holiday with calendar matching and ambience theme. */
public record SeasonalEventDefinition(
    String id,
    String displayName,
    int priority,
    Predicate<LocalDate> activeOn,
    SeasonalAmbienceTheme ambienceTheme
) {
  public boolean isActiveOn(LocalDate date) {
    return date != null && activeOn.test(date);
  }
}
