package com.realfiction.realcore.cosmetics.pets;

import org.bukkit.Location;
import org.bukkit.World;

/** Per-player cosmetic pet runtime follow state. */
public record PetActiveState(
    java.util.UUID entityId,
    String petId,
    int moveTick,
    int animationTick,
    double lastTargetX,
    double lastTargetY,
    double lastTargetZ,
    float lastTargetYaw,
    String lastTargetWorld,
    boolean hasLastTarget
) {
  public static PetActiveState initial(java.util.UUID entityId, String petId, Location spawn) {
    if (spawn == null || spawn.getWorld() == null) {
      return new PetActiveState(entityId, petId, 0, 0, 0, 0, 0, 0, "", false);
    }
    return new PetActiveState(
        entityId,
        petId,
        0,
        0,
        spawn.getX(),
        spawn.getY(),
        spawn.getZ(),
        spawn.getYaw(),
        spawn.getWorld().getName(),
        true
    );
  }

  public Location lastTargetLocation(World world) {
    if (!hasLastTarget || world == null) {
      return null;
    }
    return new Location(world, lastTargetX, lastTargetY, lastTargetZ, lastTargetYaw, 0f);
  }

  public PetActiveState withLastTarget(Location location) {
    if (location == null || location.getWorld() == null) {
      return this;
    }
    return new PetActiveState(
        entityId,
        petId,
        moveTick,
        animationTick,
        location.getX(),
        location.getY(),
        location.getZ(),
        location.getYaw(),
        location.getWorld().getName(),
        true
    );
  }

  public PetActiveState nextMoveTick() {
    return new PetActiveState(
        entityId,
        petId,
        moveTick + 1,
        animationTick + 1,
        lastTargetX,
        lastTargetY,
        lastTargetZ,
        lastTargetYaw,
        lastTargetWorld,
        hasLastTarget
    );
  }
}
