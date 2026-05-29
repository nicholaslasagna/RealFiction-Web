package com.realfiction.realcore.cosmetics.pets;

import org.bukkit.Location;
import org.bukkit.util.Vector;

/** Smooth follow interpolation and velocity helpers (testable). */
public final class PetMovementMath {
  public static final long MOVE_TICK_PERIOD = 2L;
  public static final int PARTICLE_EVERY_MOVE_TICKS = 5;

  static final double FORCE_SNAP_DISTANCE = 16.0D;
  static final double STRONG_CORRECT_DISTANCE = 4.0D;
  static final double TARGET_BLEND = 0.45D;
  static final double TARGET_HARD_SNAP_DISTANCE = 8.0D;
  static final double DISPLAY_SMOOTH_NORMAL = 0.35D;
  static final double DISPLAY_SMOOTH_FAR = 0.45D;
  static final double DISPLAY_SMOOTH_FAR_DISTANCE = 3.0D;
  static final double MAX_VELOCITY_PER_TICK = 0.42D;
  static final double STRONG_VELOCITY_PER_TICK = 0.58D;

  private PetMovementMath() {
  }

  public static boolean shouldForceSnap(double distanceSq, boolean differentWorld) {
    return differentWorld || distanceSq > FORCE_SNAP_DISTANCE * FORCE_SNAP_DISTANCE;
  }

  public static boolean shouldStrongCorrect(double distanceSq, boolean differentWorld) {
    return !differentWorld && distanceSq > STRONG_CORRECT_DISTANCE * STRONG_CORRECT_DISTANCE
        && !shouldForceSnap(distanceSq, differentWorld);
  }

  public static boolean shouldSmoothMove(double distanceSq, boolean differentWorld) {
    return !differentWorld && distanceSq > 0.01D && !shouldForceSnap(distanceSq, differentWorld);
  }

  public static boolean shouldSpawnParticles(int moveTick) {
    return moveTick > 0 && moveTick % PARTICLE_EVERY_MOVE_TICKS == 0;
  }

  public static boolean hardSnapTarget(PetActiveState state, Location desired, String desiredWorld) {
    if (state == null || !state.hasLastTarget()) {
      return true;
    }
    if (desiredWorld == null || !desiredWorld.equals(state.lastTargetWorld())) {
      return true;
    }
    double dx = desired.getX() - state.lastTargetX();
    double dy = desired.getY() - state.lastTargetY();
    double dz = desired.getZ() - state.lastTargetZ();
    return (dx * dx + dy * dy + dz * dz) > TARGET_HARD_SNAP_DISTANCE * TARGET_HARD_SNAP_DISTANCE;
  }

  public static Location smoothTarget(PetActiveState state, Location desired, String desiredWorld, boolean hardSnap) {
    Location result = desired.clone();
    if (hardSnap || state == null || !state.hasLastTarget() || desiredWorld == null
        || !desiredWorld.equals(state.lastTargetWorld())) {
      return result;
    }
    result.setX(state.lastTargetX() + (desired.getX() - state.lastTargetX()) * TARGET_BLEND);
    result.setY(state.lastTargetY() + (desired.getY() - state.lastTargetY()) * TARGET_BLEND);
    result.setZ(state.lastTargetZ() + (desired.getZ() - state.lastTargetZ()) * TARGET_BLEND);
    float yaw = lerpAngle(state.lastTargetYaw(), desired.getYaw(), (float) TARGET_BLEND);
    result.setYaw(yaw);
    result.setPitch(0f);
    return result;
  }

  public static Location interpolateDisplay(Location current, Location target, double distance) {
    double factor = distance > DISPLAY_SMOOTH_FAR_DISTANCE ? DISPLAY_SMOOTH_FAR : DISPLAY_SMOOTH_NORMAL;
    Location next = current.clone();
    next.setX(current.getX() + (target.getX() - current.getX()) * factor);
    next.setY(current.getY() + (target.getY() - current.getY()) * factor);
    next.setZ(current.getZ() + (target.getZ() - current.getZ()) * factor);
    next.setYaw(lerpAngle(current.getYaw(), resolveYaw(current, target, target.getYaw()), (float) factor));
    next.setPitch(0f);
    if (target.getWorld() != null) {
      next.setWorld(target.getWorld());
    }
    return next;
  }

  public static Vector clampedVelocity(Location current, Location target, double distance, boolean strong) {
    Vector delta = target.toVector().subtract(current.toVector());
    double maxSpeed = strong ? STRONG_VELOCITY_PER_TICK : MAX_VELOCITY_PER_TICK;
    double length = delta.length();
    if (length < 0.001D) {
      return new Vector(0, 0, 0);
    }
    if (length > maxSpeed) {
      return delta.multiply(maxSpeed / length);
    }
    return delta;
  }

  public static float resolveYaw(Location current, Location target, float playerYaw) {
    double dx = target.getX() - current.getX();
    double dz = target.getZ() - current.getZ();
    if ((dx * dx + dz * dz) < 0.0004D) {
      return playerYaw;
    }
    return (float) Math.toDegrees(Math.atan2(-dx, dz));
  }

  private static float lerpAngle(float from, float to, float blend) {
    float diff = wrapDegrees(to - from);
    return from + diff * blend;
  }

  private static float wrapDegrees(float angle) {
    float wrapped = angle % 360f;
    if (wrapped >= 180f) {
      wrapped -= 360f;
    }
    if (wrapped < -180f) {
      wrapped += 360f;
    }
    return wrapped;
  }
}
