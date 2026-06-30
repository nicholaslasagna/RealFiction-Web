package com.realfiction.realcore.halloween;

import java.time.Duration;
import java.time.Instant;
import org.bukkit.Material;
import org.bukkit.util.Vector;

public final class HerobrineStalkerRules {
  private HerobrineStalkerRules() {
  }

  public static boolean qualifies(SpookyConditions conditions, boolean requireSpookyCondition) {
    return !requireSpookyCondition || (conditions != null && conditions.any());
  }

  public static boolean cooldownElapsed(Instant now, Instant lastSeen, Duration cooldown) {
    if (now == null) {
      return false;
    }
    if (lastSeen == null) {
      return true;
    }
    Duration required = cooldown == null ? Duration.ZERO : cooldown;
    return !now.isBefore(lastSeen.plus(required));
  }

  public static boolean directLook(Vector eye, Vector direction, Vector target, double maxDistance, double minDot) {
    if (eye == null || direction == null || target == null) {
      return false;
    }
    Vector toTarget = target.clone().subtract(eye);
    double distance = toTarget.length();
    if (distance <= 0.01 || distance > maxDistance) {
      return false;
    }
    Vector normalizedDirection = direction.clone();
    if (normalizedDirection.lengthSquared() <= 0.0001) {
      return false;
    }
    return normalizedDirection.normalize().dot(toTarget.normalize()) >= minDot;
  }

  public static boolean shouldAttempt(double randomValue, double chancePerCheck) {
    if (chancePerCheck <= 0.0) {
      return false;
    }
    return randomValue <= Math.min(1.0, chancePerCheck);
  }

  public static double clampChance(double value) {
    if (Double.isNaN(value) || value < 0.0) {
      return 0.0;
    }
    return Math.min(1.0, value);
  }

  public static boolean miningIntentEligible(SpookyConditions conditions) {
    return conditions != null && (conditions.underground() || conditions.darkCave());
  }

  public static double effectiveChance(double baseChance, SpookyConditions conditions, HerobrineMiningIntentConfig miningIntent) {
    double clampedBase = Math.max(0.0, Math.min(1.0, baseChance));
    if (miningIntent == null || !miningIntent.enabled() || !miningIntentEligible(conditions)) {
      return clampedBase;
    }
    return Math.min(1.0, clampedBase * Math.max(1.0, miningIntent.chanceMultiplier()));
  }

  public static double dotForViewDegrees(double degrees) {
    double clamped = Math.max(1.0, Math.min(179.0, degrees));
    return Math.cos(Math.toRadians(clamped));
  }

  public static boolean activeBelowLimit(int activeSightings, int maxActiveSightings) {
    return activeSightings < Math.max(1, maxActiveSightings);
  }

  public static boolean insideRadius(double distanceSquared, double radius) {
    double safeRadius = Math.max(0.0, radius);
    return distanceSquared <= safeRadius * safeRadius;
  }

  public static boolean sustainedFor(Instant now, Instant startedAt, Duration required) {
    if (now == null || startedAt == null) {
      return false;
    }
    Duration safeRequired = required == null ? Duration.ZERO : required;
    return !now.isBefore(startedAt.plus(safeRequired));
  }

  public static boolean windowStalkWeatherAllowed(
      boolean darkOutside,
      boolean rainOrSnow,
      HerobrineWindowStalkConfig config
  ) {
    if (config == null || !config.enabled()) {
      return false;
    }
    if (config.requireDarkOutside() && !darkOutside) {
      return false;
    }
    return !config.requireRainOrSnow() || rainOrSnow;
  }

  public static boolean glassLike(Material type) {
    if (type == null) {
      return false;
    }
    String name = type.name();
    return type == Material.GLASS
        || type == Material.GLASS_PANE
        || type == Material.TINTED_GLASS
        || name.endsWith("_STAINED_GLASS")
        || name.endsWith("_STAINED_GLASS_PANE");
  }

  public static boolean baseLikeBlock(Material type) {
    if (type == null) {
      return false;
    }
    String name = type.name();
    return switch (type) {
      case CHEST, TRAPPED_CHEST, BARREL, FURNACE, BLAST_FURNACE, SMOKER,
          CRAFTING_TABLE, ENCHANTING_TABLE, ANVIL, CHIPPED_ANVIL, DAMAGED_ANVIL,
          BEDROCK, RESPAWN_ANCHOR, END_PORTAL_FRAME, NETHER_PORTAL, END_PORTAL,
          BEACON, HOPPER, DROPPER, DISPENSER, NOTE_BLOCK, JUKEBOX,
          COMPARATOR, REPEATER, REDSTONE_WIRE, REDSTONE_TORCH,
          REDSTONE_WALL_TORCH, LEVER, PISTON, STICKY_PISTON, OBSERVER,
          FARMLAND, BEE_NEST, BEEHIVE, BREWING_STAND, CAULDRON,
          LECTERN, LOOM, STONECUTTER, CARTOGRAPHY_TABLE, FLETCHING_TABLE,
          GRINDSTONE, SMITHING_TABLE, BELL, WHEAT, CARROTS, POTATOES,
          BEETROOTS, NETHER_WART, SUGAR_CANE, BAMBOO, COCOA,
          MELON_STEM, ATTACHED_MELON_STEM, PUMPKIN_STEM,
          ATTACHED_PUMPKIN_STEM, SWEET_BERRY_BUSH -> true;
      default -> glassLike(type)
          || name.endsWith("_BED")
          || name.endsWith("_DOOR")
          || name.endsWith("_TRAPDOOR")
          || name.endsWith("_FENCE_GATE")
          || name.endsWith("_BUTTON")
          || name.endsWith("_PRESSURE_PLATE")
          || name.endsWith("_SIGN")
          || name.endsWith("_WALL_SIGN")
          || name.endsWith("_HANGING_SIGN")
          || name.endsWith("_WALL_HANGING_SIGN")
          || name.endsWith("_BANNER")
          || name.endsWith("_WALL_BANNER")
          || name.endsWith("_SHULKER_BOX")
          || name.endsWith("_SAPLING")
          || name.endsWith("_CROP")
          || name.endsWith("_STEM")
          || name.endsWith("_FENCE")
          || name.contains("POTTED_");
    };
  }
}
