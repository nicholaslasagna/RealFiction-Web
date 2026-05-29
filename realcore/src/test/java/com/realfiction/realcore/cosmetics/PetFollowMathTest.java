package com.realfiction.realcore.cosmetics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.cosmetics.pets.PetDefinition;
import com.realfiction.realcore.cosmetics.pets.PetFollowMath;
import org.bukkit.Location;
import org.bukkit.util.Vector;
import org.junit.jupiter.api.Test;

final class PetFollowMathTest {
  @Test
  void followStyleBehindOffsetsOnePointSixBlocks() {
    Location base = locationAt(0, 64, 0, 0f);
    Location target = PetFollowMath.followLocation(base, PetDefinition.PetFollowStyle.FOLLOW, 0);
    assertEquals(64.2, target.getY(), 0.01);
    assertEquals(1.6, horizontalDistance(base, target), 0.15);
  }

  @Test
  void floatStyleRaisesYOffset() {
    Location base = locationAt(10, 70, 10, 90f);
    Location target = PetFollowMath.followLocation(base, PetDefinition.PetFollowStyle.FLOAT, 0);
    assertEquals(71.2, target.getY(), 0.01);
  }

  @Test
  void orbitStyleUsesRadiusAboutOnePointFour() {
    Location base = locationAt(0, 64, 0, 0f);
    Location a = PetFollowMath.followLocation(base, PetDefinition.PetFollowStyle.ORBIT, 0);
    Location b = PetFollowMath.followLocation(base, PetDefinition.PetFollowStyle.ORBIT, 40);
    assertEquals(1.4, horizontalDistance(base, a), 0.2);
    assertEquals(1.4, horizontalDistance(base, b), 0.2);
    assertEquals(65.0, a.getY(), 0.01);
  }

  @Test
  void floatStyleUsesSineBobbing() {
    Location base = locationAt(10, 70, 10, 90f);
    Location low = PetFollowMath.followLocation(base, PetDefinition.PetFollowStyle.FLOAT, 0);
    Location high = PetFollowMath.followLocation(base, PetDefinition.PetFollowStyle.FLOAT, 5);
    assertTrue(high.getY() > low.getY());
  }

  private static Location locationAt(double x, double y, double z, float yaw) {
    Location loc = new Location(null, x, y, z);
    loc.setYaw(yaw);
    loc.setDirection(new Vector(0, 0, 1));
    return loc;
  }

  private static double horizontalDistance(Location a, Location b) {
    double dx = a.getX() - b.getX();
    double dz = a.getZ() - b.getZ();
    return Math.sqrt(dx * dx + dz * dz);
  }
}
