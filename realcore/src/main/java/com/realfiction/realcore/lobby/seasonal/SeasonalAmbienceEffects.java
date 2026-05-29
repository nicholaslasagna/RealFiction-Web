package com.realfiction.realcore.lobby.seasonal;

import java.util.concurrent.ThreadLocalRandom;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.SoundCategory;
import org.bukkit.World;
import org.bukkit.entity.Player;

/** Theme-specific lobby spawn particle and sound bursts. */
public final class SeasonalAmbienceEffects {
  private SeasonalAmbienceEffects() {
  }

  public static void playBurst(
      SeasonalAmbienceTheme theme,
      Location origin,
      int particleBudget,
      boolean playSound,
      int tickSeed
  ) {
    if (theme == null || theme == SeasonalAmbienceTheme.NONE || origin == null || origin.getWorld() == null) {
      return;
    }
    World world = origin.getWorld();
    ThreadLocalRandom random = ThreadLocalRandom.current();
    int spent = 0;
    switch (theme) {
      case US250_INDEPENDENCE_DAY -> spent = us250Burst(world, origin, random, particleBudget, tickSeed);
      case INDEPENDENCE_DAY -> spent = independenceBurst(world, origin, random, particleBudget, tickSeed);
      case CHRISTMAS -> spent = christmasBurst(world, origin, random, particleBudget, tickSeed);
      case HANUKKAH -> spent = hanukkahBurst(world, origin, random, particleBudget, tickSeed);
      case HALLOWEEN -> spent = halloweenBurst(world, origin, random, particleBudget, tickSeed);
      case NEW_YEARS -> spent = newYearsBurst(world, origin, random, particleBudget, tickSeed);
      case CHINESE_NEW_YEAR -> spent = chineseNewYearBurst(world, origin, random, particleBudget, tickSeed);
      case VALENTINES_DAY -> spent = valentinesBurst(world, origin, random, particleBudget, tickSeed);
      case EASTER -> spent = easterBurst(world, origin, random, particleBudget, tickSeed);
      case THANKSGIVING -> spent = thanksgivingBurst(world, origin, random, particleBudget, tickSeed);
      case VETERANS_DAY -> spent = veteransBurst(world, origin, random, particleBudget, tickSeed);
      case MEMORIAL_DAY -> spent = memorialBurst(world, origin, random, particleBudget, tickSeed);
      default -> {
      }
    }
    if (playSound && spent > 0) {
      playThemeSound(theme, origin, random);
    }
  }

  public static void playSoundForPlayer(Player player, SeasonalAmbienceTheme theme, Location origin) {
    if (player == null || !player.isOnline() || theme == null || theme == SeasonalAmbienceTheme.NONE) {
      return;
    }
    if (origin == null || player.getWorld() == null || !player.getWorld().equals(origin.getWorld())) {
      return;
    }
    if (player.getLocation().distanceSquared(origin) > SeasonalAmbienceBudget.SOUND_RADIUS * SeasonalAmbienceBudget.SOUND_RADIUS) {
      return;
    }
    Sound sound = themeSound(theme, ThreadLocalRandom.current());
    if (sound == null) {
      return;
    }
    player.playSound(origin, sound, SoundCategory.AMBIENT, 0.25f, 1.0f);
  }

  private static void playThemeSound(SeasonalAmbienceTheme theme, Location origin, ThreadLocalRandom random) {
    Sound sound = themeSound(theme, random);
    if (sound == null || origin.getWorld() == null) {
      return;
    }
    origin.getWorld().playSound(origin, sound, SoundCategory.AMBIENT, 0.2f, 1.0f);
  }

  private static Sound themeSound(SeasonalAmbienceTheme theme, ThreadLocalRandom random) {
    return switch (theme) {
      case CHRISTMAS -> random.nextInt(12) == 0 ? Sound.BLOCK_NOTE_BLOCK_BELL : null;
      case HALLOWEEN -> random.nextInt(10) == 0 ? Sound.AMBIENT_CAVE : null;
      case NEW_YEARS -> random.nextInt(10) == 0 ? Sound.BLOCK_NOTE_BLOCK_CHIME : null;
      case INDEPENDENCE_DAY, US250_INDEPENDENCE_DAY ->
          random.nextInt(14) == 0 ? Sound.ENTITY_FIREWORK_ROCKET_BLAST_FAR : null;
      case CHINESE_NEW_YEAR -> random.nextInt(12) == 0 ? Sound.ENTITY_FIREWORK_ROCKET_LAUNCH : null;
      default -> null;
    };
  }

  private static int us250Burst(World world, Location origin, ThreadLocalRandom random, int budget, int tickSeed) {
    int spent = 0;
    spent += dustRing(world, origin, random, budget - spent, Color.RED, Color.WHITE, Color.BLUE, 1.2D);
    if (spent < budget && tickSeed % 3 == 0) {
      Location star = offset(origin, random, 4.0D, 2.0D);
      world.spawnParticle(Particle.END_ROD, star, 2, 0.08, 0.08, 0.08, 0.01, null, true);
      spent += 2;
    }
    if (spent < budget && random.nextInt(4) == 0) {
      Location distant = offset(origin, random, 12.0D, 1.0D);
      world.spawnParticle(Particle.FIREWORK, distant, 1, 0.1, 0.1, 0.1, 0.02, null, true);
      spent++;
    }
    if (spent < budget) {
      Location gold = offset(origin, random, 2.0D, 1.5D);
      world.spawnParticle(
          Particle.DUST,
          gold,
          2,
          0.05,
          0.05,
          0.05,
          0.0,
          new Particle.DustOptions(Color.fromRGB(255, 215, 0), 1.1f),
          true
      );
      spent += 2;
    }
    double ringAngle = tickSeed * 0.35D;
    if (spent < budget) {
      Location ring = origin.clone().add(Math.cos(ringAngle) * 3.5D, 0.8D, Math.sin(ringAngle) * 3.5D);
      world.spawnParticle(Particle.DUST, ring, 1, 0, 0, 0, 0, dust(Color.WHITE), true);
      spent++;
    }
    return spent;
  }

  private static int independenceBurst(World world, Location origin, ThreadLocalRandom random, int budget, int tickSeed) {
    int spent = dustRing(world, origin, random, budget, Color.RED, Color.WHITE, Color.BLUE, 1.0D);
    if (spent < budget && random.nextInt(5) == 0) {
      Location trail = offset(origin, random, 10.0D, 2.5D);
      world.spawnParticle(Particle.FIREWORK, trail, 1, 0.05, 0.2, 0.05, 0.01, null, true);
      spent++;
    }
    if (spent < budget && tickSeed % 4 == 0) {
      Location crackle = offset(origin, random, 5.0D, 1.0D);
      world.spawnParticle(Particle.FIREWORK, crackle, 1, 0.1, 0.1, 0.1, 0.0, null, true);
      spent++;
    }
    return spent;
  }

  private static int christmasBurst(World world, Location origin, ThreadLocalRandom random, int budget, int tickSeed) {
    int spent = 0;
    if (spent < budget) {
      Location snow = offset(origin, random, 5.0D, 2.0D);
      world.spawnParticle(Particle.SNOWFLAKE, snow, Math.min(3, budget), 0.4, 0.5, 0.4, 0.01, null, true);
      spent += Math.min(3, budget);
    }
    if (spent < budget) {
      world.spawnParticle(Particle.END_ROD, offset(origin, random, 3.0D, 1.5D), 1, 0.1, 0.1, 0.1, 0.0, null, true);
      spent++;
    }
    if (spent < budget && tickSeed % 2 == 0) {
      Location spiral = offset(origin, random, 4.0D, 1.0D);
      world.spawnParticle(Particle.DUST, spiral, 1, 0.1, 0.2, 0.1, 0, dust(Color.fromRGB(0, 128, 0)), true);
      world.spawnParticle(Particle.DUST, spiral, 1, 0.1, 0.2, 0.1, 0, dust(Color.RED), true);
      spent += 2;
    }
    if (spent < budget) {
      Location globe = origin.clone().add(0, 1.2D, 0);
      world.spawnParticle(Particle.CLOUD, globe, 2, 0.6, 0.4, 0.6, 0.01, null, true);
      spent += 2;
    }
    return spent;
  }

  private static int hanukkahBurst(World world, Location origin, ThreadLocalRandom random, int budget, int tickSeed) {
    int spent = dustRing(world, origin, random, budget, Color.fromRGB(30, 80, 220), Color.WHITE, Color.fromRGB(255, 215, 0), 1.0D);
    if (spent < budget) {
      Location flame = offset(origin, random, 2.5D, 0.6D);
      world.spawnParticle(Particle.SMALL_FLAME, flame, 2, 0.05, 0.15, 0.05, 0.01, null, true);
      spent += 2;
    }
    if (spent < budget && tickSeed % 3 == 0) {
      Location shimmer = origin.clone().add(0, random.nextDouble(1.5D, 3.5D), 0);
      world.spawnParticle(Particle.END_ROD, shimmer, 1, 0.05, 0.4, 0.05, 0.0, null, true);
      spent++;
    }
    return spent;
  }

  private static int halloweenBurst(World world, Location origin, ThreadLocalRandom random, int budget, int tickSeed) {
    int spent = 0;
    Location wisp = offset(origin, random, 5.0D, 1.0D);
    world.spawnParticle(Particle.WITCH, wisp, Math.min(2, budget), 0.3, 0.4, 0.3, 0.01, null, true);
    spent += Math.min(2, budget);
    if (spent < budget) {
      world.spawnParticle(Particle.SOUL_FIRE_FLAME, offset(origin, random, 4.0D, 0.8D), 1, 0.1, 0.2, 0.1, 0.01, null, true);
      spent++;
    }
    if (spent < budget && tickSeed % 4 == 0) {
      double angle = random.nextDouble(0, Math.PI * 2);
      Location arc = origin.clone().add(Math.cos(angle) * 4.0D, 1.5D + Math.sin(angle * 2) * 0.5D, Math.sin(angle) * 4.0D);
      world.spawnParticle(Particle.SMOKE, arc, 2, 0.1, 0.1, 0.1, 0.02, null, true);
      spent += 2;
    }
    if (spent < budget) {
      world.spawnParticle(
          Particle.DUST,
          offset(origin, random, 3.0D, 0.5D),
          2,
          0.1,
          0.1,
          0.1,
          0,
          dust(Color.fromRGB(255, 140, 0)),
          true
      );
      spent += 2;
    }
    return spent;
  }

  private static int newYearsBurst(World world, Location origin, ThreadLocalRandom random, int budget, int tickSeed) {
    int spent = dustRing(world, origin, random, budget, Color.fromRGB(255, 215, 0), Color.WHITE, Color.fromRGB(180, 80, 255), 1.2D);
    if (spent < budget) {
      Location fountain = origin.clone().add(random.nextDouble(-1.5D, 1.5D), 0.2D, random.nextDouble(-1.5D, 1.5D));
      world.spawnParticle(Particle.FIREWORK, fountain, 2, 0.2, 1.2, 0.2, 0.04, null, true);
      spent += 2;
    }
    if (spent < budget && tickSeed % 2 == 0) {
      world.spawnParticle(Particle.HAPPY_VILLAGER, offset(origin, random, 4.0D, 1.5D), 1, 0.2, 0.2, 0.2, 0, null, true);
      spent++;
    }
    return spent;
  }

  private static int chineseNewYearBurst(World world, Location origin, ThreadLocalRandom random, int budget, int tickSeed) {
    int spent = dustRing(world, origin, random, budget, Color.RED, Color.fromRGB(255, 215, 0), Color.RED, 1.0D);
    if (spent < budget) {
      double t = tickSeed * 0.25D;
      Location ribbon = origin.clone().add(Math.cos(t) * 5.0D, 1.0D + Math.sin(t * 2) * 0.4D, Math.sin(t) * 5.0D);
      world.spawnParticle(Particle.DRAGON_BREATH, ribbon, 2, 0.1, 0.1, 0.1, 0.01, null, true);
      spent += 2;
    }
    if (spent < budget) {
      Location lantern = offset(origin, random, 3.5D, 1.2D);
      world.spawnParticle(Particle.SMALL_FLAME, lantern, 2, 0.08, 0.08, 0.08, 0.01, null, true);
      world.spawnParticle(Particle.END_ROD, lantern, 1, 0.05, 0.1, 0.05, 0.0, null, true);
      spent += 3;
    }
    if (spent < budget && random.nextInt(6) == 0) {
      world.spawnParticle(Particle.FIREWORK, offset(origin, random, 8.0D, 2.0D), 1, 0.1, 0.1, 0.1, 0.02, null, true);
      spent++;
    }
    return spent;
  }

  private static int valentinesBurst(World world, Location origin, ThreadLocalRandom random, int budget, int tickSeed) {
    int spent = 0;
    if (spent < budget) {
      Location hearts = offset(origin, random, 4.0D, 1.2D);
      world.spawnParticle(Particle.HEART, hearts, Math.min(3, budget), 0.25, 0.3, 0.25, 0.01, null, true);
      spent += Math.min(3, budget);
    }
    if (spent < budget && tickSeed % 3 == 0) {
      double angle = tickSeed * 0.4D;
      Location pulse = origin.clone().add(Math.cos(angle) * 2.8D, 1.0D, Math.sin(angle) * 2.8D);
      world.spawnParticle(Particle.HEART, pulse, 1, 0, 0, 0, 0, null, true);
      spent++;
    }
    if (spent < budget) {
      world.spawnParticle(Particle.END_ROD, offset(origin, random, 5.0D, 1.5D), 1, 0.15, 0.15, 0.15, 0.0, null, true);
      spent++;
    }
    return spent;
  }

  private static int easterBurst(World world, Location origin, ThreadLocalRandom random, int budget, int tickSeed) {
    int spent = 0;
    Color[] pastels = {
        Color.fromRGB(255, 182, 193),
        Color.fromRGB(173, 216, 230),
        Color.fromRGB(255, 255, 153),
        Color.fromRGB(221, 160, 221)
    };
    Color color = pastels[random.nextInt(pastels.length)];
    if (spent < budget) {
      world.spawnParticle(Particle.DUST, offset(origin, random, 4.0D, 1.0D), 2, 0.2, 0.2, 0.2, 0, dust(color), true);
      spent += 2;
    }
    if (spent < budget) {
      world.spawnParticle(Particle.HAPPY_VILLAGER, offset(origin, random, 3.5D, 1.2D), 1, 0.15, 0.15, 0.15, 0, null, true);
      spent++;
    }
    if (spent < budget && tickSeed % 2 == 0) {
      world.spawnParticle(Particle.EGG_CRACK, offset(origin, random, 3.0D, 0.4D), 1, 0.1, 0.1, 0.1, 0, null, true);
      spent++;
    }
    return spent;
  }

  private static int thanksgivingBurst(World world, Location origin, ThreadLocalRandom random, int budget, int tickSeed) {
    int spent = dustRing(
        world,
        origin,
        random,
        budget,
        Color.fromRGB(255, 140, 0),
        Color.fromRGB(139, 69, 19),
        Color.fromRGB(255, 215, 0),
        1.0D
    );
    if (spent < budget) {
      Location leaf = offset(origin, random, 6.0D, 2.5D);
      world.spawnParticle(Particle.FALLING_DUST, leaf, 2, 0.4, 0.2, 0.4, 0, org.bukkit.Material.OAK_LEAVES.createBlockData(), true);
      spent += 2;
    }
    if (spent < budget && tickSeed % 3 == 0) {
      world.spawnParticle(Particle.CAMPFIRE_COSY_SMOKE, offset(origin, random, 3.0D, 0.3D), 1, 0.1, 0.2, 0.1, 0.01, null, true);
      spent++;
    }
    return spent;
  }

  private static int veteransBurst(World world, Location origin, ThreadLocalRandom random, int budget, int tickSeed) {
    int spent = dustRing(world, origin, random, Math.min(budget, 8), Color.RED, Color.WHITE, Color.BLUE, 0.8D);
    if (spent < budget && tickSeed % 4 == 0) {
      world.spawnParticle(Particle.END_ROD, offset(origin, random, 4.0D, 1.8D), 1, 0.05, 0.05, 0.05, 0, null, true);
      spent++;
    }
    return spent;
  }

  private static int memorialBurst(World world, Location origin, ThreadLocalRandom random, int budget, int tickSeed) {
    int spent = dustRing(world, origin, random, Math.min(budget, 10), Color.WHITE, Color.fromRGB(255, 215, 0), Color.RED, 0.7D);
    if (spent < budget) {
      world.spawnParticle(Particle.END_ROD, offset(origin, random, 5.0D, 1.5D), 1, 0.05, 0.2, 0.05, 0, null, true);
      spent++;
    }
    return spent;
  }

  private static int dustRing(
      World world,
      Location origin,
      ThreadLocalRandom random,
      int budget,
      Color first,
      Color second,
      Color third,
      double yOffset
  ) {
    int spent = 0;
    Color[] colors = {first, second, third};
    while (spent < budget && spent < 8) {
      Location point = offset(origin, random, random.nextDouble(4.0D, 10.0D), yOffset);
      Color color = colors[spent % colors.length];
      world.spawnParticle(Particle.DUST, point, 1, 0.05, 0.05, 0.05, 0, dust(color), true);
      spent++;
    }
    return spent;
  }

  private static Location offset(Location origin, ThreadLocalRandom random, double horizontal, double yOffset) {
    double angle = random.nextDouble(0, Math.PI * 2);
    double radius = random.nextDouble(SeasonalAmbienceBudget.MIN_RADIUS, SeasonalAmbienceBudget.MAX_RADIUS);
    if (horizontal > 0) {
      radius = Math.min(radius, horizontal);
    }
    return origin.clone().add(Math.cos(angle) * radius, yOffset + random.nextDouble(-0.6D, 0.6D), Math.sin(angle) * radius);
  }

  private static Particle.DustOptions dust(Color color) {
    return new Particle.DustOptions(color, 1.0f);
  }
}
