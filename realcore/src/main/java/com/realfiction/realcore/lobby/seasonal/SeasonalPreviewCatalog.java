package com.realfiction.realcore.lobby.seasonal;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/** Preview event IDs, aliases, and display metadata (bypasses calendar windows). */
public final class SeasonalPreviewCatalog {
  public enum PreviewKind {
    STANDARD,
    US250_MIDNIGHT
  }

  public record PreviewSpec(
      String canonicalId,
      String displayName,
      String ambienceEventId,
      SeasonalAmbienceTheme theme,
      PreviewKind kind
  ) {
    public boolean midnightPreview() {
      return kind == PreviewKind.US250_MIDNIGHT;
    }
  }

  private static final Map<String, PreviewSpec> BY_ALIAS = build();

  private SeasonalPreviewCatalog() {
  }

  public static Optional<PreviewSpec> resolve(String rawId) {
    if (rawId == null || rawId.isBlank()) {
      return Optional.empty();
    }
    return Optional.ofNullable(BY_ALIAS.get(rawId.trim().toLowerCase(Locale.ROOT)));
  }

  public static List<String> validIds() {
    return List.copyOf(BY_ALIAS.keySet());
  }

  public static String validIdsMessage() {
    return String.join(", ", validIds());
  }

  private static Map<String, PreviewSpec> build() {
    Map<String, PreviewSpec> map = new LinkedHashMap<>();
    registerHoliday(map, "christmas", "Christmas", SeasonalAmbienceTheme.CHRISTMAS);
    registerHoliday(map, "halloween", "Halloween", SeasonalAmbienceTheme.HALLOWEEN);
    registerHoliday(map, "new_years", "New Year's", SeasonalAmbienceTheme.NEW_YEARS);
    registerHoliday(map, "hanukkah", "Hanukkah", SeasonalAmbienceTheme.HANUKKAH);
    registerHoliday(map, "chinese_new_year", "Chinese New Year", SeasonalAmbienceTheme.CHINESE_NEW_YEAR);
    registerHoliday(map, "lunar_new_year", "Chinese New Year", SeasonalAmbienceTheme.CHINESE_NEW_YEAR);
    registerHoliday(map, "valentines_day", "Valentine's Day", SeasonalAmbienceTheme.VALENTINES_DAY);
    registerHoliday(map, "easter", "Easter", SeasonalAmbienceTheme.EASTER);
    registerHoliday(map, "thanksgiving", "Thanksgiving", SeasonalAmbienceTheme.THANKSGIVING);
    registerHoliday(map, "veterans_day", "Veterans Day", SeasonalAmbienceTheme.VETERANS_DAY);
    registerHoliday(map, "memorial_day", "Memorial Day", SeasonalAmbienceTheme.MEMORIAL_DAY);
    registerHoliday(map, "independence_day", "Independence Day", SeasonalAmbienceTheme.INDEPENDENCE_DAY);
    registerHoliday(map, "us250_independence_day", "US 250 Independence", SeasonalAmbienceTheme.US250_INDEPENDENCE_DAY);

    map.put("us250", map.get("us250_independence_day"));

    PreviewSpec midnight = new PreviewSpec(
        "us250_midnight",
        "US 250 Midnight",
        "us250_independence_day",
        SeasonalAmbienceTheme.US250_INDEPENDENCE_DAY,
        PreviewKind.US250_MIDNIGHT
    );
    map.put("us250_midnight", midnight);
    map.put("us250_midnight_eastern", midnight);
    map.put("us250_midnight_central", midnight);
    map.put("us250_midnight_pacific", midnight);
    return Map.copyOf(map);
  }

  private static void registerHoliday(
      Map<String, PreviewSpec> map,
      String id,
      String displayName,
      SeasonalAmbienceTheme theme
  ) {
    PreviewSpec spec = new PreviewSpec(id, displayName, id, theme, PreviewKind.STANDARD);
    map.put(id, spec);
  }
}
