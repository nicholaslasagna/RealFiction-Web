package com.realfiction.realcore.lobby.seasonal;

import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/** Visual/sound palette for lobby spawn ambience. */
public enum SeasonalAmbienceTheme {
  US250_INDEPENDENCE_DAY,
  INDEPENDENCE_DAY,
  CHRISTMAS,
  HANUKKAH,
  HALLOWEEN,
  NEW_YEARS,
  CHINESE_NEW_YEAR,
  VALENTINES_DAY,
  EASTER,
  THANKSGIVING,
  VETERANS_DAY,
  MEMORIAL_DAY,
  NONE;

  private static final Map<String, SeasonalAmbienceTheme> BY_EVENT_ID = Map.ofEntries(
      Map.entry("us250_independence_day", US250_INDEPENDENCE_DAY),
      Map.entry("independence_day", INDEPENDENCE_DAY),
      Map.entry("christmas", CHRISTMAS),
      Map.entry("hanukkah", HANUKKAH),
      Map.entry("halloween", HALLOWEEN),
      Map.entry("new_years", NEW_YEARS),
      Map.entry("chinese_new_year", CHINESE_NEW_YEAR),
      Map.entry("lunar_new_year", CHINESE_NEW_YEAR),
      Map.entry("valentines_day", VALENTINES_DAY),
      Map.entry("easter", EASTER),
      Map.entry("thanksgiving", THANKSGIVING),
      Map.entry("veterans_day", VETERANS_DAY),
      Map.entry("memorial_day", MEMORIAL_DAY)
  );

  public static SeasonalAmbienceTheme forEventId(String eventId) {
    if (eventId == null || eventId.isBlank()) {
      return NONE;
    }
    return BY_EVENT_ID.getOrDefault(eventId.trim().toLowerCase(Locale.ROOT), NONE);
  }

  public static Optional<String> validateEventId(String eventId) {
    if (eventId == null || eventId.isBlank()) {
      return Optional.empty();
    }
    String normalized = eventId.trim().toLowerCase(Locale.ROOT);
    if (BY_EVENT_ID.containsKey(normalized)) {
      return Optional.of(normalized);
    }
    return Optional.empty();
  }
}
