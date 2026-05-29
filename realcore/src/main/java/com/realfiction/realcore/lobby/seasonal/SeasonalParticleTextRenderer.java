package com.realfiction.realcore.lobby.seasonal;

import java.util.ArrayList;
import java.util.List;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.World;

/** Renders bitmap particle text above a seasonal show origin. */
public final class SeasonalParticleTextRenderer {
  private static final double PIXEL_SCALE = 0.38D;
  private static final double LINE_GAP = 2.8D;
  private static final double SKY_HEIGHT = 12.0D;
  private static final double FORWARD_DISTANCE = 8.0D;

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
    List<SkyPixel> pixels = layoutLine(anchor, text, color, yOffset);
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
    pixels.addAll(layoutLine(anchor, topLine, topColor, LINE_GAP * 0.5D));
    pixels.addAll(layoutLine(anchor, bottomLine, bottomColor, -LINE_GAP * 0.5D));
    if (pixels.isEmpty() || anchor.getWorld() == null) {
      return;
    }
    scheduler.runGlobal(() -> spawnPixels(anchor.getWorld(), pixels));
  }

  private static List<SkyPixel> layoutLine(Location anchor, String text, Color color, double lineYOffset) {
    List<SkyPixel> pixels = new ArrayList<>();
    if (anchor == null || anchor.getWorld() == null || text == null || text.isBlank()) {
      return pixels;
    }
    float yaw = anchor.getYaw();
    double forwardX = -Math.sin(Math.toRadians(yaw));
    double forwardZ = Math.cos(Math.toRadians(yaw));
    double rightX = Math.cos(Math.toRadians(yaw));
    double rightZ = Math.sin(Math.toRadians(yaw));
    double baseX = anchor.getX() + forwardX * FORWARD_DISTANCE;
    double baseY = anchor.getY() + SKY_HEIGHT + lineYOffset;
    double baseZ = anchor.getZ() + forwardZ * FORWARD_DISTANCE;
    int textWidth = ParticleBitmapFont.textWidth(text);
    double startOffset = -textWidth * PIXEL_SCALE * 0.5D;

    ParticleBitmapFont.forEachPixel(text, (column, row) -> {
      double localX = (column * PIXEL_SCALE) + startOffset;
      double localY = -row * PIXEL_SCALE;
      double worldX = baseX + rightX * localX;
      double worldY = baseY + localY;
      double worldZ = baseZ + rightZ * localX;
      pixels.add(new SkyPixel(worldX, worldY, worldZ, color));
    });
    return pixels;
  }

  private static void spawnPixels(World world, List<SkyPixel> pixels) {
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
  }
}
