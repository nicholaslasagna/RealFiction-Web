package com.realfiction.realcore.cosmetics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.cosmetics.pets.PetActiveState;
import com.realfiction.realcore.cosmetics.pets.PetCosmetics;
import com.realfiction.realcore.cosmetics.pets.PetDefinition;
import com.realfiction.realcore.cosmetics.pets.PetDisplayMode;
import com.realfiction.realcore.cosmetics.pets.PetFollowMath;
import com.realfiction.realcore.cosmetics.pets.PetMovementMath;
import org.bukkit.Location;
import org.bukkit.util.Vector;
import org.junit.jupiter.api.Test;

final class PetMovementMathTest {
  @Test
  void forceSnapBeyondSixteenBlocks() {
    assertTrue(PetMovementMath.shouldForceSnap(17.0 * 17.0, false));
    assertFalse(PetMovementMath.shouldForceSnap(3.0 * 3.0, false));
  }

  @Test
  void strongCorrectBetweenFourAndSixteenBlocks() {
    assertTrue(PetMovementMath.shouldStrongCorrect(5.0 * 5.0, false));
    assertFalse(PetMovementMath.shouldStrongCorrect(2.0 * 2.0, false));
  }

  @Test
  void displayInterpolatesWithinSmoothRange() {
    Location current = locationAt(0, 64, 0);
    Location target = locationAt(2, 64.5, 1);
    Location next = PetMovementMath.interpolateDisplay(current, target, 2.2D);
    assertEquals(0.7, next.getX(), 0.01);
    assertNotEquals(target.getX(), next.getX(), 0.01);
  }

  @Test
  void targetSmoothingReducesSuddenJump() {
    PetActiveState state = new PetActiveState(
        java.util.UUID.randomUUID(),
        "fox-friend",
        0,
        0,
        5,
        64,
        3,
        0f,
        "Lobby1",
        true
    );
    Location desired = locationAt(6, 65, 4);
    Location smoothed = PetMovementMath.smoothTarget(state, desired, "Lobby1", false);
    assertEquals(5.45, smoothed.getX(), 0.1);
    assertEquals(64.45, smoothed.getY(), 0.1);
  }

  @Test
  void particlesThrottleDoesNotRunEveryMoveTick() {
    assertFalse(PetMovementMath.shouldSpawnParticles(1));
    assertFalse(PetMovementMath.shouldSpawnParticles(4));
    assertTrue(PetMovementMath.shouldSpawnParticles(5));
    assertTrue(PetMovementMath.shouldSpawnParticles(10));
  }

  @Test
  void tinyDragonUsesDisplayMode() {
    PetDefinition dragon = PetCosmetics.definition("tiny-dragon");
    assertTrue(dragon.displayPet());
    assertEquals(PetDisplayMode.DISPLAY, dragon.displayMode());
  }

  @Test
  void orbitPhaseAdvancesSmoothly() {
    Location base = locationAt(0, 64, 0, 0f);
    Location a = PetFollowMath.followLocation(base, PetDefinition.PetFollowStyle.ORBIT, 10);
    Location b = PetFollowMath.followLocation(base, PetDefinition.PetFollowStyle.ORBIT, 11);
    double dist = Math.hypot(a.getX() - b.getX(), a.getZ() - b.getZ());
    assertTrue(dist < 0.35D);
  }

  @Test
  void glideStopsInsideArriveRadius() {
    // Within ~0.28 blocks (< the 0.45 arrive radius) the pet holds still
    // instead of buzzing back and forth.
    Vector velocity = PetMovementMath.glideVelocity(locationAt(0, 64, 0), locationAt(0.2, 64, 0.2));
    assertEquals(0.0, velocity.length(), 1e-9);
  }

  @Test
  void glideCapsSpeedWhenFarAndPointsAtTarget() {
    Vector velocity = PetMovementMath.glideVelocity(locationAt(0, 64, 0), locationAt(10, 64, 0));
    assertEquals(0.6, velocity.length(), 1e-6); // capped at GLIDE_MAX_PER_TICK
    assertTrue(velocity.getX() > 0); // heads toward the target
  }

  @Test
  void glideEasesDownWhenClose() {
    // 1 block away -> speed eases to len * GLIDE_EASE = 0.5 (below the cap),
    // so it decelerates smoothly into the target.
    Vector velocity = PetMovementMath.glideVelocity(locationAt(0, 64, 0), locationAt(1.0, 64, 0));
    assertEquals(0.5, velocity.length(), 1e-6);
  }

  @Test
  void faceYawEasesTowardTravelDirection() {
    Location current = locationAt(0, 64, 0); // yaw 0
    Location desired = locationAt(5, 64, 0); // travel toward +x -> yaw -90
    float yaw = PetMovementMath.faceYaw(current, desired, current.getYaw(), 0f);
    // Eased 40% of the way from 0 toward -90.
    assertEquals(-36.0, yaw, 0.5);
  }

  private static Location locationAt(double x, double y, double z) {
    return locationAt(x, y, z, 0f);
  }

  private static Location locationAt(double x, double y, double z, float yaw) {
    Location loc = new Location(null, x, y, z);
    loc.setYaw(yaw);
    loc.setDirection(new Vector(0, 0, 1));
    return loc;
  }
}
