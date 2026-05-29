package com.realfiction.realcore.lobby.seasonal;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

final class SeasonalAmbienceThemeTest {
  @Test
  void mapsEventIdsToThemes() {
    assertEquals(SeasonalAmbienceTheme.US250_INDEPENDENCE_DAY, SeasonalAmbienceTheme.forEventId("us250_independence_day"));
    assertEquals(SeasonalAmbienceTheme.CHRISTMAS, SeasonalAmbienceTheme.forEventId("christmas"));
    assertEquals(SeasonalAmbienceTheme.CHINESE_NEW_YEAR, SeasonalAmbienceTheme.forEventId("lunar_new_year"));
    assertEquals(SeasonalAmbienceTheme.NONE, SeasonalAmbienceTheme.forEventId("unknown"));
  }
}
