package com.realfiction.realcore.lobby.seasonal;

import com.realfiction.realcore.scheduler.RealCoreScheduler;
import java.time.LocalDate;
import java.time.Month;
import java.util.List;
import org.bukkit.Sound;
import org.bukkit.SoundCategory;
import org.bukkit.entity.Player;

/**
 * The seasonal "midnight song" library, played with vanilla Minecraft
 * note-block bell sounds — no resource pack, no MP3.
 *
 * <p>Single source of truth for both:
 * <ul>
 *   <li><b>The Star-Spangled Banner</b> — patriotic holidays (US 250,
 *       Independence Day, Memorial Day, Veterans Day).</li>
 *   <li><b>Jingle Bells</b> — Christmas.</li>
 * </ul>
 *
 * <p>Shared by {@link SeasonalCelebrationService} (the real song that plays as
 * the clock strikes midnight in Eastern/Central/Pacific time on the holiday's
 * peak day) and {@link SeasonalPreviewController} (so {@code /rf seasonal
 * preview <holiday>} plays the real song and admins can verify it on demand).
 *
 * <p>Pitches are transposed into the note-block range (F#3..F#5 = 0.5..2.0);
 * {@code delayTicks} are relative to the first note. 20 ticks = 1 second.
 */
public final class SeasonalSongbook {
  private SeasonalSongbook() {
  }

  /** A single note: onset delay (ticks, from the first note) + note-block pitch. */
  public record Note(long delayTicks, float pitch) {
  }

  /** Lowest / highest playable note-block pitch (F#3..F#5). */
  public static final float MIN_PITCH = 0.5f;
  public static final float MAX_PITCH = 2.0f;

  // "Oh-oh, say can you see, by the dawn's early light..."
  public static final List<Note> STAR_SPANGLED_BANNER = List.of(
      new Note(0,   0.707f),  // "Oh"      C4
      new Note(10,  0.707f),  // "oh"      C4
      new Note(22,  0.944f),  // "say"     F4
      new Note(34,  1.189f),  // "can"     A4
      new Note(46,  1.414f),  // "you"     C5
      new Note(58,  1.888f),  // "see,"    F5  (climax)
      new Note(82,  1.782f),  // "by"      E5
      new Note(94,  1.587f),  // "the"     D5
      new Note(106, 1.414f),  // "dawn's"  C5
      new Note(118, 1.189f),  // "ear-"    A4
      new Note(130, 0.944f),  // "-ly"     F4
      new Note(142, 1.189f),  // "light"   A4
      new Note(166, 0.944f)   // tail resolution F4
  );

  // "Jingle bells, jingle bells, jingle all the way / Oh what fun it is to ride"
  // C-major chorus: 3 3 3 | 3 3 3 | 3 5 1 2 3 | 4 4 4 4 4 3 3
  public static final List<Note> JINGLE_BELLS = List.of(
      new Note(0,   0.891f),  // E  "Jin-"
      new Note(12,  0.891f),  // E  "-gle"
      new Note(24,  0.891f),  // E  "bells"
      new Note(40,  0.891f),  // E  "Jin-"
      new Note(52,  0.891f),  // E  "-gle"
      new Note(64,  0.891f),  // E  "bells"
      new Note(80,  0.891f),  // E  "Jin-"
      new Note(92,  1.059f),  // G  "-gle"
      new Note(104, 0.707f),  // C  "all"
      new Note(116, 0.794f),  // D  "the"
      new Note(128, 0.891f),  // E  "way"   (held)
      new Note(156, 0.944f),  // F  "Oh"
      new Note(168, 0.944f),  // F  "what"
      new Note(180, 0.944f),  // F  "fun"
      new Note(192, 0.944f),  // F  "it"
      new Note(204, 0.944f),  // F  "is"
      new Note(216, 0.891f),  // E  "to"
      new Note(228, 0.891f)   // E  "ride"
  );

  /** The song for a theme, or {@code null} if the theme has no midnight song. */
  public static List<Note> songFor(SeasonalAmbienceTheme theme) {
    if (theme == null) {
      return null;
    }
    return switch (theme) {
      case US250_INDEPENDENCE_DAY, INDEPENDENCE_DAY, MEMORIAL_DAY, VETERANS_DAY -> STAR_SPANGLED_BANNER;
      case CHRISTMAS -> JINGLE_BELLS;
      default -> null;
    };
  }

  public static boolean hasSong(SeasonalAmbienceTheme theme) {
    return songFor(theme) != null;
  }

  /** Human-readable song name for broadcasts. */
  public static String songName(SeasonalAmbienceTheme theme) {
    if (theme == SeasonalAmbienceTheme.CHRISTMAS) {
      return "Jingle Bells";
    }
    return "The National Anthem";
  }

  /**
   * The calendar day a theme's song fires (midnight in each US zone), or
   * {@code null} if the theme has no song.
   */
  public static LocalDate peakDay(SeasonalAmbienceTheme theme, int year) {
    if (theme == null) {
      return null;
    }
    return switch (theme) {
      case INDEPENDENCE_DAY, US250_INDEPENDENCE_DAY -> LocalDate.of(year, Month.JULY, 4);
      case VETERANS_DAY -> LocalDate.of(year, Month.NOVEMBER, 11);
      case MEMORIAL_DAY -> HolidayDateRules.memorialDay(year);
      case CHRISTMAS -> LocalDate.of(year, Month.DECEMBER, 25);
      default -> null;
    };
  }

  /**
   * Schedules a full song for one player through the player scheduler
   * (Folia-safe). Each note re-checks the player is online before playing and
   * uses the ambient sound category so it respects the player's volume slider.
   */
  public static void schedule(RealCoreScheduler scheduler, Player player, float volume, List<Note> song) {
    if (song == null) {
      return;
    }
    for (Note note : song) {
      scheduler.runForPlayerLater(player, () -> {
        if (!player.isOnline()) {
          return;
        }
        player.playSound(player.getLocation(), Sound.BLOCK_NOTE_BLOCK_BELL,
            SoundCategory.AMBIENT, volume, note.pitch());
      }, note.delayTicks());
    }
  }
}
