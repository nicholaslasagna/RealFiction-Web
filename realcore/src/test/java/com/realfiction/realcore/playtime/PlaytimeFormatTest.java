package com.realfiction.realcore.playtime;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

final class PlaytimeFormatTest {
  @Test
  void formatsCompactDurations() {
    assertEquals("0m", PlaytimeFormat.human(0));
    assertEquals("0m", PlaytimeFormat.human(-5));
    assertEquals("0m", PlaytimeFormat.human(30));
    assertEquals("1m", PlaytimeFormat.human(60));
    assertEquals("1m", PlaytimeFormat.human(90));
    assertEquals("1h", PlaytimeFormat.human(3600));
    assertEquals("1h 1m", PlaytimeFormat.human(3661));
    assertEquals("1d", PlaytimeFormat.human(86400));
    assertEquals("1d 1h 1m", PlaytimeFormat.human(86400 + 3600 + 60));
  }
}
