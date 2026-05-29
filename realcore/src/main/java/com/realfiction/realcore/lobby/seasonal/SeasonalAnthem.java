package com.realfiction.realcore.lobby.seasonal;

import com.realfiction.realcore.scheduler.RealCoreScheduler;
import java.util.List;
import org.bukkit.Sound;
import org.bukkit.SoundCategory;
import org.bukkit.entity.Player;

/**
 * The US national anthem ("The Star-Spangled Banner" opening phrase) rendered
 * with vanilla Minecraft note-block sounds — no resource pack, no MP3.
 *
 * <p>This is the single source of truth for the melody. It is shared by:
 * <ul>
 *   <li>{@link SeasonalCelebrationService} — the real anthem that plays for
 *       lobby players as the clock strikes midnight in Eastern, Central, and
 *       Pacific time on a patriotic holiday's peak day (Independence Day,
 *       US 250, Memorial Day, Veterans Day).</li>
 *   <li>{@link SeasonalPreviewController} — so {@code /rf seasonal preview
 *       us250_midnight} plays the actual anthem, letting admins hear and
 *       verify it on demand instead of waiting for July 4 at midnight.</li>
 * </ul>
 *
 * <p>Pitches are transposed into the note-block range (F#3..F#5 =
 * pitch 0.5..2.0). {@code delayTicks} are relative to t=0 (the first note);
 * 20 ticks = 1 second.
 *
 * <p>"Oh-oh, say can you see, by the dawn's early light..."
 */
public final class SeasonalAnthem {
  private SeasonalAnthem() {
  }

  /** A single note: onset delay (ticks, relative to the first note) + note-block pitch. */
  public record Note(long delayTicks, float pitch) {
  }

  /** Lowest / highest playable note-block pitch (F#3..F#5). */
  public static final float MIN_PITCH = 0.5f;
  public static final float MAX_PITCH = 2.0f;

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

  /** Ticks from the first note to the onset of the last note. */
  public static long durationTicks() {
    return STAR_SPANGLED_BANNER.get(STAR_SPANGLED_BANNER.size() - 1).delayTicks();
  }

  /**
   * Schedules the full anthem for a single player through the player
   * scheduler (Folia-safe). Each note re-checks that the player is still
   * online before playing, and uses the ambient sound category so it
   * respects the player's ambient volume slider.
   */
  public static void schedule(RealCoreScheduler scheduler, Player player, float volume) {
    for (Note note : STAR_SPANGLED_BANNER) {
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
