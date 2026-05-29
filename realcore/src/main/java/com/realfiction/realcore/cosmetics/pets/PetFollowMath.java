package com.realfiction.realcore.cosmetics.pets;

import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.util.Vector;

/** Stable follow offsets for lobby cosmetic pets (testable, no Bukkit entity access). */
public final class PetFollowMath {
  static final double BEHIND_HORIZONTAL = 1.6D;
  static final double BEHIND_Y = 0.2D;
  static final double FLOAT_BASE_Y = 1.2D;
  static final double FLOAT_BOB_AMPLITUDE = 0.12D;
  static final double ORBIT_RADIUS = 1.4D;
  static final double ORBIT_BASE_Y = 1.0D;
  static final double ORBIT_ANGLE_STEP = 0.07D;

  private PetFollowMath() {
  }

  public static Location followLocation(Player player, PetDefinition.PetFollowStyle style, int animationTick) {
    return followLocation(player.getLocation(), style, animationTick);
  }

  public static Location followLocation(Location base, PetDefinition.PetFollowStyle style, int animationTick) {
    Vector forward = horizontalForward(base);
    Vector right = new Vector(-forward.getZ(), 0, forward.getX());
    Location target = base.clone();
    double bob = Math.sin(animationTick * 0.15D) * FLOAT_BOB_AMPLITUDE;
    switch (style) {
      case ORBIT -> {
        double angle = animationTick * ORBIT_ANGLE_STEP;
        target.add(right.clone().multiply(Math.cos(angle) * ORBIT_RADIUS));
        target.add(forward.clone().multiply(Math.sin(angle) * ORBIT_RADIUS));
        target.add(0, ORBIT_BASE_Y + bob * 0.5D, 0);
      }
      case FLOAT -> {
        target.subtract(forward.clone().multiply(1.0D));
        target.add(right.clone().multiply(0.55D));
        target.add(0, FLOAT_BASE_Y + bob, 0);
      }
      case FOLLOW -> {
        target.subtract(forward.clone().multiply(BEHIND_HORIZONTAL));
        target.add(0, BEHIND_Y + bob * 0.35D, 0);
      }
      default -> {
        target.subtract(forward.clone().multiply(BEHIND_HORIZONTAL));
        target.add(0, BEHIND_Y, 0);
      }
    }
    target.setYaw(base.getYaw());
    target.setPitch(0f);
    return target;
  }

  /** @deprecated use {@link PetMovementMath#shouldForceSnap} */
  @Deprecated
  public static boolean shouldSnap(double distanceSq, boolean differentWorld) {
    return PetMovementMath.shouldForceSnap(distanceSq, differentWorld);
  }

  /** @deprecated use {@link PetMovementMath#shouldSmoothMove} */
  @Deprecated
  public static boolean shouldNudge(double distanceSq, boolean differentWorld) {
    return PetMovementMath.shouldSmoothMove(distanceSq, differentWorld);
  }

  private static Vector horizontalForward(Location base) {
    Vector forward = base.getDirection().setY(0);
    if (forward.lengthSquared() < 0.01) {
      return new Vector(0, 0, 1);
    }
    return forward.normalize();
  }
}
