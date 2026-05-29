package com.realfiction.realcore.lobby.seasonal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import java.time.Month;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Locks the seasonal songs: the Star-Spangled Banner for patriotic holidays
 * and Jingle Bells for Christmas — both well-formed note-block melodies, mapped
 * to the right themes and peak days so the midnight tick fires the correct song.
 */
final class SeasonalSongbookTest {

  private static void assertWellFormed(List<SeasonalSongbook.Note> song) {
    assertFalse(song.isEmpty());
    assertEquals(0L, song.get(0).delayTicks(), "song must start at tick 0");
    for (int i = 0; i < song.size(); i++) {
      float pitch = song.get(i).pitch();
      assertTrue(pitch >= SeasonalSongbook.MIN_PITCH && pitch <= SeasonalSongbook.MAX_PITCH,
          "pitch " + pitch + " outside note-block range");
      if (i > 0) {
        assertTrue(song.get(i).delayTicks() > song.get(i - 1).delayTicks(),
            "note " + i + " does not come after the previous note");
      }
    }
  }

  @Test
  void anthemIsWellFormedWithASingleClimax() {
    assertWellFormed(SeasonalSongbook.STAR_SPANGLED_BANNER);
    assertEquals(13, SeasonalSongbook.STAR_SPANGLED_BANNER.size());
    // "...rockets' red glare" climax — the 6th note ("see,") is the highest.
    float max = 0f;
    int maxIndex = -1;
    for (int i = 0; i < SeasonalSongbook.STAR_SPANGLED_BANNER.size(); i++) {
      if (SeasonalSongbook.STAR_SPANGLED_BANNER.get(i).pitch() > max) {
        max = SeasonalSongbook.STAR_SPANGLED_BANNER.get(i).pitch();
        maxIndex = i;
      }
    }
    assertEquals(5, maxIndex);
    assertEquals(1.888f, max, 0.0001f);
  }

  @Test
  void jingleBellsIsWellFormedAndRecognizable() {
    assertWellFormed(SeasonalSongbook.JINGLE_BELLS);
    assertEquals(18, SeasonalSongbook.JINGLE_BELLS.size());
    // "Jingle bells, jingle bells" — the first six notes are the same pitch (E).
    float e = SeasonalSongbook.JINGLE_BELLS.get(0).pitch();
    for (int i = 1; i < 6; i++) {
      assertEquals(e, SeasonalSongbook.JINGLE_BELLS.get(i).pitch(), 0.0001f,
          "opening 'jingle bells' notes should all be the same pitch");
    }
    // "...jingle ALL the way" dips to the lowest note of the phrase on "all".
    float all = SeasonalSongbook.JINGLE_BELLS.get(8).pitch();
    assertTrue(all < e, "the 'all' note should dip below the 'jingle' E");
  }

  @Test
  void patrioticThemesMapToTheAnthem() {
    for (SeasonalAmbienceTheme theme : List.of(
        SeasonalAmbienceTheme.US250_INDEPENDENCE_DAY,
        SeasonalAmbienceTheme.INDEPENDENCE_DAY,
        SeasonalAmbienceTheme.MEMORIAL_DAY,
        SeasonalAmbienceTheme.VETERANS_DAY)) {
      assertTrue(SeasonalSongbook.hasSong(theme), theme + " should have a song");
      assertSame(SeasonalSongbook.STAR_SPANGLED_BANNER, SeasonalSongbook.songFor(theme));
      assertEquals("The National Anthem", SeasonalSongbook.songName(theme));
    }
  }

  @Test
  void christmasMapsToJingleBells() {
    assertTrue(SeasonalSongbook.hasSong(SeasonalAmbienceTheme.CHRISTMAS));
    assertSame(SeasonalSongbook.JINGLE_BELLS, SeasonalSongbook.songFor(SeasonalAmbienceTheme.CHRISTMAS));
    assertEquals("Jingle Bells", SeasonalSongbook.songName(SeasonalAmbienceTheme.CHRISTMAS));
    assertEquals(LocalDate.of(2026, Month.DECEMBER, 25),
        SeasonalSongbook.peakDay(SeasonalAmbienceTheme.CHRISTMAS, 2026));
  }

  @Test
  void nonSongThemesHaveNoSong() {
    for (SeasonalAmbienceTheme theme : List.of(
        SeasonalAmbienceTheme.HALLOWEEN,
        SeasonalAmbienceTheme.NEW_YEARS,
        SeasonalAmbienceTheme.EASTER,
        SeasonalAmbienceTheme.VALENTINES_DAY)) {
      assertFalse(SeasonalSongbook.hasSong(theme), theme + " should not have a song");
      assertNull(SeasonalSongbook.songFor(theme));
      assertNull(SeasonalSongbook.peakDay(theme, 2026));
    }
  }

  @Test
  void patrioticPeakDaysAreCorrect() {
    assertEquals(LocalDate.of(2026, Month.JULY, 4),
        SeasonalSongbook.peakDay(SeasonalAmbienceTheme.US250_INDEPENDENCE_DAY, 2026));
    assertEquals(LocalDate.of(2026, Month.JULY, 4),
        SeasonalSongbook.peakDay(SeasonalAmbienceTheme.INDEPENDENCE_DAY, 2026));
    assertEquals(LocalDate.of(2026, Month.NOVEMBER, 11),
        SeasonalSongbook.peakDay(SeasonalAmbienceTheme.VETERANS_DAY, 2026));
  }
}
