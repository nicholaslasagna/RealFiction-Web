package com.realfiction.realcore.lobby.seasonal;

import com.realfiction.realcore.scheduler.RealCoreScheduler;
import org.bukkit.Color;
import org.bukkit.FireworkEffect;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Firework;
import org.bukkit.entity.Player;
import org.bukkit.inventory.meta.FireworkMeta;

/** Distant lobby firework pads for seasonal previews and sky shows. */
public final class FireworkShowService {
  private final RealCoreScheduler scheduler;

  public FireworkShowService(RealCoreScheduler scheduler) {
    this.scheduler = scheduler;
  }

  public void launchRing(Location origin, int count, SeasonalEffectPalette palette) {
    if (origin == null || origin.getWorld() == null || count <= 0) {
      return;
    }
    scheduler.runGlobal(() -> {
      World world = origin.getWorld();
      for (int i = 0; i < count; i++) {
        double angle = (Math.PI * 2 * i) / count;
        double radius = 10 + (i % 3) * 2.5D;
        Location pad = origin.clone().add(Math.cos(angle) * radius, 1.2D, Math.sin(angle) * radius);
        spawnFirework(world, pad, palette);
      }
    });
  }

  public void burstAt(Location location, SeasonalEffectPalette palette) {
    if (location == null || location.getWorld() == null) {
      return;
    }
    scheduler.runGlobal(() -> spawnFirework(location.getWorld(), location, palette));
  }

  private static void spawnFirework(World world, Location location, SeasonalEffectPalette palette) {
    Firework firework = world.spawn(location, Firework.class);
    FireworkMeta meta = firework.getFireworkMeta();
    meta.addEffect(FireworkEffect.builder()
        .withColor(palette.primary(), palette.secondary(), palette.accent())
        .withFade(palette.sparkle())
        .with(palette.burstType())
        .flicker(true)
        .trail(true)
        .build());
    meta.setPower(1);
    firework.setFireworkMeta(meta);
    firework.detonate();
  }

  public static void playCountdownSound(Player player, int number) {
    if (player == null || !player.isOnline()) {
      return;
    }
    float pitch = switch (number) {
      case 3 -> 0.8f;
      case 2 -> 1.0f;
      case 1 -> 1.2f;
      default -> 1.4f;
    };
    player.playSound(player.getLocation(), org.bukkit.Sound.BLOCK_NOTE_BLOCK_PLING, 0.6f, pitch);
  }
}
