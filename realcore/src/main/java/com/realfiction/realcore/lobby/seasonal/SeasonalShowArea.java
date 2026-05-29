package com.realfiction.realcore.lobby.seasonal;

import java.util.concurrent.ThreadLocalRandom;
import org.bukkit.Location;

/**
 * Keeps every seasonal show effect — fireworks, firework rings, the patriotic
 * dust storm, and the REALFICTION sky banner — inside the navigable lobby
 * corridor and high enough that firework blasts can never hurt players.
 *
 * <p>Before this, ambient fireworks spawned 55–110 blocks out (a show "in the
 * distance" nobody was standing under) and the big-show / preview rings
 * detonated just {@code +1.2} above the anchor — basically at head height,
 * which dealt firework blast damage to players standing near the lobby spawn.
 *
 * <p>The corridor is expressed on the Z axis (Lobby1 walkable area runs from
 * spawn at {@code z = -124} out to {@code z = -178}). X is kept as a modest
 * spread around the anchor's X (the lobby width), and Y is a safe overhead
 * band above the anchor so blasts stay well clear of the ~5-block firework
 * damage radius. If the lobby layout ever changes, these four bounds are the
 * only thing to retune.
 */
public final class SeasonalShowArea {
  private SeasonalShowArea() {
  }

  /** Walkable lobby corridor on the Z axis (inclusive). */
  public static final double Z_MIN = -178.0D;
  public static final double Z_MAX = -124.0D;

  /** Horizontal spread on X, in blocks, on either side of the anchor. */
  public static final double X_HALF_WIDTH = 20.0D;

  /**
   * Overhead height band (blocks above the anchor) for ambient fireworks.
   * Comfortably above the ~5-block firework blast radius so a detonation can
   * never reach a player on the ground.
   */
  public static final double FIREWORK_HEIGHT_MIN = 16.0D;
  public static final double FIREWORK_HEIGHT_MAX = 30.0D;

  /** Height (blocks above the anchor) at which firework rings detonate. */
  public static final double RING_HEIGHT = 18.0D;

  /** Z at the middle of the corridor — where centered effects (rings, banner) anchor. */
  public static double centerZ() {
    return (Z_MIN + Z_MAX) / 2.0D;
  }

  /** Clamp a Z value into the walkable corridor. */
  public static double clampZ(double z) {
    return Math.max(Z_MIN, Math.min(Z_MAX, z));
  }

  /**
   * The center of the show: the anchor's X/Y but pinned to the middle of the
   * Z corridor, so centered effects (firework rings, dust storm, sky banner)
   * sit in the middle of the play area regardless of where spawn is along it.
   */
  public static Location center(Location anchor) {
    Location center = anchor.clone();
    center.setZ(centerZ());
    return center;
  }

  /**
   * A random firework pad inside the corridor at a safe overhead height:
   * X within {@link #X_HALF_WIDTH} of the anchor, Z anywhere along the
   * corridor, Y in the safe overhead band above the anchor.
   */
  public static Location randomFireworkPad(Location anchor, ThreadLocalRandom random) {
    double x = anchor.getX() + (random.nextDouble() * 2.0D - 1.0D) * X_HALF_WIDTH;
    double z = Z_MIN + random.nextDouble() * (Z_MAX - Z_MIN);
    double y = anchor.getY() + FIREWORK_HEIGHT_MIN
        + random.nextDouble() * (FIREWORK_HEIGHT_MAX - FIREWORK_HEIGHT_MIN);
    Location pad = anchor.clone();
    pad.setX(x);
    pad.setY(y);
    pad.setZ(z);
    return pad;
  }
}
