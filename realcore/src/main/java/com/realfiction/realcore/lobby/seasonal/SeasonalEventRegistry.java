package com.realfiction.realcore.lobby.seasonal;

import java.time.LocalDate;
import java.time.Month;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/** Built-in seasonal events and active-event resolution. */
public final class SeasonalEventRegistry {
  private final Map<String, SeasonalEventDefinition> byId;
  private final List<SeasonalEventDefinition> ordered;

  public SeasonalEventRegistry() {
    this(buildDefaults());
  }

  SeasonalEventRegistry(List<SeasonalEventDefinition> definitions) {
    Map<String, SeasonalEventDefinition> map = new LinkedHashMap<>();
    for (SeasonalEventDefinition definition : definitions) {
      map.put(definition.id(), definition);
    }
    this.byId = Map.copyOf(map);
    this.ordered = List.copyOf(definitions);
  }

  public Optional<SeasonalEventDefinition> byId(String id) {
    if (id == null || id.isBlank()) {
      return Optional.empty();
    }
    return Optional.ofNullable(byId.get(id.trim().toLowerCase(Locale.ROOT)));
  }

  public SeasonalEventDefinition activeEvent(LocalDate date) {
    if (date == null) {
      return null;
    }
    return ordered.stream()
        .filter(definition -> definition.isActiveOn(date))
        .max(Comparator.comparingInt(SeasonalEventDefinition::priority))
        .orElse(null);
  }

  public int definitionCount() {
    return byId.size();
  }

  public List<String> eventIds() {
    return List.copyOf(byId.keySet());
  }

  private static List<SeasonalEventDefinition> buildDefaults() {
    List<SeasonalEventDefinition> events = new ArrayList<>();

    events.add(new SeasonalEventDefinition(
        "us250_independence_day",
        "US 250 Independence",
        1000,
        HolidayDateRules::isUs250Window,
        SeasonalAmbienceTheme.US250_INDEPENDENCE_DAY
    ));

    events.add(new SeasonalEventDefinition(
        "independence_day",
        "Independence Day",
        200,
        date -> {
          if (HolidayDateRules.independenceDaySuppressed(date)) {
            return false;
          }
          LocalDate july4 = LocalDate.of(date.getYear(), Month.JULY, 4);
          return SeasonalEventWindow.aroundHoliday(july4).contains(date);
        },
        SeasonalAmbienceTheme.INDEPENDENCE_DAY
    ));

    events.add(fixedHoliday("christmas", "Christmas", 150, Month.DECEMBER, 25, SeasonalAmbienceTheme.CHRISTMAS));
    events.add(fixedHoliday("valentines_day", "Valentine's Day", 150, Month.FEBRUARY, 14, SeasonalAmbienceTheme.VALENTINES_DAY));
    events.add(fixedHoliday("halloween", "Halloween", 150, Month.OCTOBER, 31, SeasonalAmbienceTheme.HALLOWEEN));
    events.add(fixedHoliday("new_years", "New Year's", 150, Month.JANUARY, 1, SeasonalAmbienceTheme.NEW_YEARS));
    events.add(fixedHoliday("veterans_day", "Veterans Day", 140, Month.NOVEMBER, 11, SeasonalAmbienceTheme.VETERANS_DAY));

    events.add(variableHoliday(
        "memorial_day",
        "Memorial Day",
        140,
        year -> SeasonalEventWindow.aroundHoliday(HolidayDateRules.memorialDay(year)),
        SeasonalAmbienceTheme.MEMORIAL_DAY
    ));

    events.add(variableHoliday(
        "thanksgiving",
        "Thanksgiving",
        140,
        year -> SeasonalEventWindow.aroundHoliday(HolidayDateRules.thanksgiving(year)),
        SeasonalAmbienceTheme.THANKSGIVING
    ));

    events.add(variableHoliday(
        "easter",
        "Easter",
        140,
        year -> SeasonalEventWindow.aroundHoliday(HolidayDateRules.easterSunday(year)),
        SeasonalAmbienceTheme.EASTER
    ));

    events.add(variableHoliday(
        "hanukkah",
        "Hanukkah",
        140,
        year -> {
          LocalDate start = HolidayDateRules.hanukkahStart(year);
          if (start == null) {
            return null;
          }
          return SeasonalEventWindow.aroundHoliday(start);
        },
        SeasonalAmbienceTheme.HANUKKAH
    ));

    events.add(variableHoliday(
        "chinese_new_year",
        "Chinese New Year",
        140,
        year -> {
          LocalDate start = HolidayDateRules.chineseNewYear(year);
          if (start == null) {
            return null;
          }
          return SeasonalEventWindow.aroundHoliday(start);
        },
        SeasonalAmbienceTheme.CHINESE_NEW_YEAR
    ));

    return List.copyOf(events);
  }

  private static SeasonalEventDefinition fixedHoliday(
      String id,
      String name,
      int priority,
      Month month,
      int day,
      SeasonalAmbienceTheme theme
  ) {
    return new SeasonalEventDefinition(
        id,
        name,
        priority,
        date -> SeasonalEventWindow.aroundHoliday(LocalDate.of(date.getYear(), month, day)).contains(date),
        theme
    );
  }

  private static SeasonalEventDefinition variableHoliday(
      String id,
      String name,
      int priority,
      java.util.function.IntFunction<SeasonalEventWindow> windowForYear,
      SeasonalAmbienceTheme theme
  ) {
    return new SeasonalEventDefinition(
        id,
        name,
        priority,
        date -> {
          SeasonalEventWindow window = windowForYear.apply(date.getYear());
          return window != null && window.contains(date);
        },
        theme
    );
  }
}
