package com.realfiction.realcore.lobby.seasonal;

import java.util.ArrayList;
import java.util.List;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.World;

/** Renders bitmap particle text above (or in the distance beyond) a seasonal show origin. */
public final class SeasonalParticleTextRenderer {
  // Close, overhead banner (used for the per-theme tagline above spawn).
  private static final double PIXEL_SCALE = 0.38D;
  private static final double LINE_GAP = 2.8D;
  private static final double SKY_HEIGHT = 12.0D;
  private static final double FORWARD_DISTANCE = 8.0D;

  // Distant "REALFICTION" sign: a big sky banner placed well out in front of
  // spawn (along the spawn's facing) and high up, so during events it reads as
  // a giant sign on the horizon while fireworks pop closer to the lobby. Forced
  // DUST particles render at this range for normal view distances.
  private static final double DISTANT_PIXEL_SCALE = 0.78D;
  private static final double DISTANT_LINE_GAP = 6.0D;
  private static final double DISTANT_SKY_HEIGHT = 34.0D;
  private static final double DISTANT_FORWARD_DISTANCE = 72.0D;

  private SeasonalParticleTextRenderer() {
  }

  public record SkyPixel(double x, double y, double z, Color color) {
  }

  public static void renderLine(
      com.realfiction.realcore.scheduler.RealCoreScheduler scheduler,
      Location anchor,
      String text,
      Color color,
      double yOffset
  ) {
    List<SkyPixel> pixels =
        layoutLine(anchor, text, color, yOffset, FORWARD_DISTANCE, SKY_HEIGHT, PIXEL_SCALE);
    if (pixels.isEmpty() || anchor.getWorld() == null) {
      return;
    }
    scheduler.runGlobal(() -> spawnPixels(anchor.getWorld(), pixels));
  }

  public static void renderBanner(
      com.realfiction.realcore.scheduler.RealCoreScheduler scheduler,
      Location anchor,
      String topLine,
      String bottomLine,
      Color topColor,
      Color bottomColor
  ) {
    List<SkyPixel> pixels = new ArrayList<>();
    pixels.addAll(layoutLine(anchor, topLine, topColor, LINE_GAP * 0.5D,
        FORWARD_DISTANCE, SKY_HEIGHT, PIXEL_SCALE));
    pixels.addAll(layoutLine(anchor, bottomLine, bottomColor, -LINE_GAP * 0.5D,
        FORWARD_DISTANCE, SKY_HEIGHT, PIXEL_SCALE));
    if (pixels.isEmpty() || anchor.getWorld() == null) {
      return;
    }
    scheduler.runGlobal(() -> spawnPixels(anchor.getWorld(), pixels));
  }

  /**
   * Large banner painted far out in front of {@code anchor} (along its facing)
   * and high up — the "REALFICTION" sign on the horizon during events. Pass a
   * {@code null} bottom line to render just the top line.
   */
  public static void renderDistantBanner(
      com.realfiction.realcore.scheduler.RealCoreScheduler scheduler,
      Location anchor,
      String topLine,
      String bottomLine,
      Color topColor,
      Color bottomColor
  ) {
    List<SkyPixel> pixels = new ArrayList<>();
    if (bottomLine == null || bottomLine.isBlank()) {
      pixels.addAll(layoutLine(anchor, topLine, topColor, 0.0D,
          DISTANT_FORWARD_DISTANCE, DISTANT_SKY_HEIGHT, DISTANT_PIXEL_SCALE));
    } else {
      pixels.addAll(layoutLine(anchor, topLine, topColor, DISTANT_LINE_GAP * 0.5D,
          DISTANT_FORWARD_DISTANCE, DISTANT_SKY_HEIGHT, DISTANT_PIXEL_SCALE));
      pixels.addAll(layoutLine(anchor, bottomLine, bottomColor, -DISTANT_LINE_GAP * 0.5D,
          DISTANT_FORWARD_DISTANCE, DISTANT_SKY_HEIGHT, DISTANT_PIXEL_SCALE));
    }
    if (pixels.isEmpty() || anchor.getWorld() == null) {
      return;
    }
    scheduler.runGlobal(() -> spawnPixels(anchor.getWorld(), pixels));
  }

  private static List<SkyPixel> layoutLine(
      Location anchor,
      String text,
      Color color,
      double lineYOffset,
      double forwardDistance,
      double skyHeight,
      double pixelScale
  ) {
    List<SkyPixel> pixels = new ArrayList<>();
    if (anchor == null || anchor.getWorld() == null || text == null || text.isBlank()) {
      return pixels;
    }
    float yaw = anchor.getYaw();
    double forwardX = -Math.sin(Math.toRadians(yaw));
    double forwardZ = Math.cos(Math.toRadians(yaw));
    double rightX = Math.cos(Math.toRadians(yaw));
    double rightZ = Math.sin(Math.toRadians(yaw));
    double baseX = anchor.getX() + forwardX * forwardDistance;
    double baseY = anchor.getY() + skyHeight + lineYOffset;
    double baseZ = anchor.getZ() + forwardZ * forwardDistance;
    int textWidth = ParticleBitmapFont.textWidth(text);
    double startOffset = -textWidth * pixelScale * 0.5D;

    ParticleBitmapFont.forEachPixel(text, (column, row) -> {
      double localX = (column * pixelScale) + startOffset;
      double localY = -row * pixelScale;
      double worldX = baseX + rightX * localX;
      double worldY = baseY + localY;
      double worldZ = baseZ + rightZ * localX;
      pixels.add(new SkyPixel(worldX, worldY, worldZ, color));
    });
    return pixels;
  }

  private static void spawnPixels(World world, List<SkyPixel> pixels) {
    // Guarded so a DUST data-contract change could never throw out of the
    // repeating banner tick and take the server down.
    SeasonalEffectGuard.run("sky-banner", () -> {
      for (SkyPixel pixel : pixels) {
        world.spawnParticle(
            Particle.DUST,
            pixel.x(),
            pixel.y(),
            pixel.z(),
            1,
            0,
            0,
            0,
            0,
            new Particle.DustOptions(pixel.color(), 1.2f),
            true
        );
      }
    });
  }
}
