package com.realfiction.realcore.lobby.seasonal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import java.time.Month;
import org.junit.jupiter.api.Test;

/**
 * Locks the behavior that the US national anthem plays on the US 250
 * Independence Day (July 4, 2026):
 *
 * <ul>
 *   <li>The shared {@link SeasonalAnthem} melody is well-formed (note-block
 *       safe pitches, ascending timing, a single climax).</li>
 *   <li>The US 250 theme is recognized as an anthem theme and its peak day
 *       is July 4, so the midnight tick fires the anthem on that date.</li>
 *   <li>The registry actually resolves July 4, 2026 to the US 250 theme, so
 *       {@code effectiveEvent} hands the celebration service an anthem theme
 *       that day — wiring the two halves together.</li>
 * </ul>
 */
final class SeasonalAnthemTest {

  @Test
  void anthemHasTheExpectedNumberOfNotes() {
    assertEquals(13, SeasonalAnthem.STAR_SPANGLED_BANNER.size());
  }

  @Test
  void everyPitchSitsInsideTheNoteBlockRange() {
    for (SeasonalAnthem.Note note : SeasonalAnthem.STAR_SPANGLED_BANNER) {
      assertTrue(
          note.pitch() >= SeasonalAnthem.MIN_PITCH && note.pitch() <= SeasonalAnthem.MAX_PITCH,
          "pitch " + note.pitch() + " is outside the note-block range");
    }
  }

  @Test
  void noteOnsetsAreStrictlyIncreasingAndStartAtZero() {
    var notes = SeasonalAnthem.STAR_SPANGLED_BANNER;
    assertEquals(0L, notes.get(0).delayTicks());
    for (int i = 1; i < notes.size(); i++) {
      assertTrue(
          notes.get(i).delayTicks() > notes.get(i - 1).delayTicks(),
          "note " + i + " does not come after the previous note");
    }
  }

  @Test
  void theClimaxIsTheSingleHighestNote() {
    float max = 0f;
    int maxIndex = -1;
    var notes = SeasonalAnthem.STAR_SPANGLED_BANNER;
    for (int i = 0; i < notes.size(); i++) {
      if (notes.get(i).pitch() > max) {
        max = notes.get(i).pitch();
        maxIndex = i;
      }
    }
    // "...the rockets' red glare" climax is the 6th note ("see,").
    assertEquals(5, maxIndex);
    assertEquals(1.888f, max, 0.0001f);
  }

  @Test
  void durationMatchesTheLastNoteOnset() {
    assertEquals(166L, SeasonalAnthem.durationTicks());
  }

  @Test
  void us250IndependenceDayIsAnAnthemTheme() {
    assertTrue(SeasonalCelebrationService.isAnthemTheme(
        SeasonalAmbienceTheme.US250_INDEPENDENCE_DAY));
    assertTrue(SeasonalCelebrationService.isAnthemTheme(
        SeasonalAmbienceTheme.INDEPENDENCE_DAY));
    assertFalse(SeasonalCelebrationService.isAnthemTheme(
        SeasonalAmbienceTheme.CHRISTMAS));
  }

  @Test
  void us250AnthemPeakIsJulyFourth() {
    assertEquals(
        LocalDate.of(2026, Month.JULY, 4),
        SeasonalCelebrationService.anthemPeakDay(
            SeasonalAmbienceTheme.US250_INDEPENDENCE_DAY, 2026));
    // Non-anthem theme has no peak day.
    assertNull(SeasonalCelebrationService.anthemPeakDay(
        SeasonalAmbienceTheme.CHRISTMAS, 2026));
  }

  @Test
  void julyFourth2026ResolvesToTheUs250AnthemTheme() {
    SeasonalEventDefinition active =
        new SeasonalEventRegistry().activeEvent(LocalDate.of(2026, Month.JULY, 4));
    assertNotNull(active);
    assertEquals(SeasonalAmbienceTheme.US250_INDEPENDENCE_DAY, active.ambienceTheme());
    assertTrue(SeasonalCelebrationService.isAnthemTheme(active.ambienceTheme()),
        "the effective theme on US 250 Independence Day must be an anthem theme");
    assertEquals(
        LocalDate.of(2026, Month.JULY, 4),
        SeasonalCelebrationService.anthemPeakDay(active.ambienceTheme(), 2026));
  }
}
