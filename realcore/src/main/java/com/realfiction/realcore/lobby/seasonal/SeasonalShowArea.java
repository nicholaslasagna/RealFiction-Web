package com.realfiction.realcore.lobby.seasonal;

import java.util.concurrent.ThreadLocalRandom;
import org.bukkit.Location;

/**
 * Keeps every seasonal show effect — fireworks, firework rings, the patriotic
 * dust storm, and the REALFICTION sky banner — inside the navigable lobby
 * area and high enough that firework blasts can never hurt players.
 *
 * <p>Before this, ambient fireworks spawned 55–110 blocks out (a show "in the
 * distance" nobody was standing under) and the big-show / preview rings
 * detonated just {@code +1.2} above the anchor — basically at head height —
 * which dealt firework blast damage to players standing near the lobby spawn.
 *
 * <p>The walkable area runs along Z from spawn ({@code z = -124}) out to
 * {@code z = -178}: a 54-block span, center {@code z = -151}. Every effect is
 * contained to a disc of {@link #SHOW_RADIUS} blocks around that center (which
 * fits inside the 54-block area) and Z is hard-clamped to the corridor as a
 * belt-and-suspenders guarantee. Y is a safe overhead band above the anchor so
 * blasts stay well clear of the ~5-block firework damage radius. If the lobby
 * layout ever changes, these bounds are the only thing to retune.
 */
public final class SeasonalShowArea {
  private SeasonalShowArea() {
  }

  /** Walkable lobby corridor on the Z axis (inclusive). */
  public static final double Z_MIN = -178.0D;
  public static final double Z_MAX = -124.0D;

  /**
   * Horizontal radius (blocks) of the show disc, measured from the corridor
   * center. 24 keeps the full disc (48 across) inside the 54-block area with a
   * margin on every side, so nothing ever lands outside the navigable space.
   */
  public static final double SHOW_RADIUS = 24.0D;

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
   * A random firework pad inside the show disc at a safe overhead height:
   * a uniformly-distributed point within {@link #SHOW_RADIUS} of the corridor
   * center, Z hard-clamped to the corridor, Y in the safe overhead band.
   */
  public static Location randomFireworkPad(Location anchor, ThreadLocalRandom random) {
    Location center = center(anchor);
    // sqrt() for a uniform distribution across the disc area (not clustered
    // at the center).
    double radius = SHOW_RADIUS * Math.sqrt(random.nextDouble());
    double theta = random.nextDouble() * Math.PI * 2.0D;
    double x = center.getX() + Math.cos(theta) * radius;
    double z = clampZ(center.getZ() + Math.sin(theta) * radius);
    double y = anchor.getY() + FIREWORK_HEIGHT_MIN
        + random.nextDouble() * (FIREWORK_HEIGHT_MAX - FIREWORK_HEIGHT_MIN);
    Location pad = anchor.clone();
    pad.setX(x);
    pad.setY(y);
    pad.setZ(z);
    return pad;
  }
}
