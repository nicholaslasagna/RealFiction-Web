package com.realfiction.realcore.stats;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

final class StatPlaceholdersTest {
  @Test
  void parsesDottedStatKeysWithRankAndField() {
    StatPlaceholders.TopRequest req = StatPlaceholders.parseTop("playtime.total_top_1_name");
    assertEquals("playtime.total", req.statKey());
    assertEquals(1, req.rank());
    assertEquals("name", req.field());

    StatPlaceholders.TopRequest value = StatPlaceholders.parseTop("votes.total_top_10_value");
    assertEquals("votes.total", value.statKey());
    assertEquals(10, value.rank());
    assertEquals("value", value.field());

    StatPlaceholders.TopRequest time = StatPlaceholders.parseTop("playtime.smp_top_1_time");
    assertEquals("playtime.smp", time.statKey());
    assertEquals(1, time.rank());
    assertEquals("time", time.field());
  }

  @Test
  void detectsPlaytimeStatKeys() {
    assertEquals(true, StatPlaceholders.isPlaytimeStatKey("playtime.total"));
    assertEquals(true, StatPlaceholders.isPlaytimeStatKey("playtime.smp"));
    assertEquals(false, StatPlaceholders.isPlaytimeStatKey("votes.total"));
  }

  @Test
  void rejectsMalformedPlaceholders() {
    assertNull(StatPlaceholders.parseTop("playtime.total"));
    assertNull(StatPlaceholders.parseTop("_top_1_name"));
    assertNull(StatPlaceholders.parseTop("playtime.total_top_x_name"));
    assertNull(StatPlaceholders.parseTop("playtime.total_top_0_name"));
    assertNull(StatPlaceholders.parseTop(null));
  }

  @Test
  void formatsValuesWithoutTrailingZero() {
    assertEquals("1234", StatPlaceholders.formatValue(1234.0));
    assertEquals("0", StatPlaceholders.formatValue(0.0));
    assertEquals("12.5", StatPlaceholders.formatValue(12.5));
  }
}
