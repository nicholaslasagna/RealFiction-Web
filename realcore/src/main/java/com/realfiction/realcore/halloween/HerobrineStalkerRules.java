package com.realfiction.realcore.halloween;

import java.time.Duration;
import java.time.Instant;
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
}
