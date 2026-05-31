package com.realfiction.realcore.cosmetics.pets;

import com.destroystokyo.paper.entity.ai.Goal;
import com.destroystokyo.paper.entity.ai.GoalKey;
import com.destroystokyo.paper.entity.ai.GoalType;
import java.util.EnumSet;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;

/**
 * Vanilla-style "follow your owner" goal for a walking cosmetic pet.
 *
 * <p>This mirrors exactly how a tamed wolf / cat follows: every AI tick it
 * paths to a point just behind the owner, and teleports if it falls too far
 * behind (or the owner changes world). Running it as a real {@link Goal} —
 * registered on the mob and ticked inside the mob's own AI step — is the key:
 * navigation only physically moves (and animates) the entity when it is driven
 * from within the AI tick. The previous approach drove navigation from an
 * external scheduler tick on an AI-disabled mob, so the pet stood frozen and
 * only ever teleported once it drifted far away.
 *
 * <p>The mob has every other vanilla goal stripped (see
 * {@code CosmeticsPetService.configureMob}), so it does nothing but follow — a
 * Fox can't flee/sleep and a Rabbit can't panic away.
 */
public final class PetFollowGoal implements Goal<Mob> {
  private static final GoalKey<Mob> KEY =
      GoalKey.of(Mob.class, new NamespacedKey("realcore", "pet_follow"));

  private static final double START_FOLLOW = 2.4D; // start pathing once the gap exceeds this
  private static final double STOP_FOLLOW = 1.3D; // settle once within this
  private static final double TELEPORT_DISTANCE = 16.0D; // snap if it ever falls this far behind
  private static final double SPEED = 1.2D; // pathfinder speed multiplier
  private static final int RECALC_INTERVAL = 8; // re-path roughly every 0.4s, like vanilla pets

  private final Mob mob;
  private final UUID ownerId;
  private final PetDefinition.PetFollowStyle style;
  private int animationTick;
  private int recalc;

  public PetFollowGoal(Mob mob, UUID ownerId, PetDefinition.PetFollowStyle style) {
    this.mob = mob;
    this.ownerId = ownerId;
    this.style = style;
  }

  private Location followPoint() {
    try {
      Player owner = Bukkit.getPlayer(ownerId);
      if (owner == null || !owner.isOnline()) {
        return null;
      }
      Location ownerLoc = owner.getLocation();
      if (ownerLoc.getWorld() == null || !ownerLoc.getWorld().equals(mob.getWorld())) {
        return null;
      }
      return PetFollowMath.followLocation(ownerLoc, style, animationTick);
    } catch (Throwable ignored) {
      // Owner not readable from this region this tick — stay put.
      return null;
    }
  }

  @Override
  public boolean shouldActivate() {
    Location point = followPoint();
    return point != null && mob.getLocation().distanceSquared(point) > START_FOLLOW * START_FOLLOW;
  }

  @Override
  public boolean shouldStayActive() {
    Location point = followPoint();
    return point != null && mob.getLocation().distanceSquared(point) > STOP_FOLLOW * STOP_FOLLOW;
  }

  @Override
  public void start() {
    recalc = 0;
  }

  @Override
  public void stop() {
    try {
      mob.getPathfinder().stopPathfinding();
    } catch (Throwable ignored) {
      // best effort
    }
  }

  @Override
  public void tick() {
    animationTick++;
    Location point = followPoint();
    if (point == null) {
      return;
    }
    double distanceSq = mob.getLocation().distanceSquared(point);
    if (distanceSq > TELEPORT_DISTANCE * TELEPORT_DISTANCE) {
      mob.teleportAsync(point);
      recalc = 0;
      return;
    }
    if (recalc-- <= 0) {
      recalc = RECALC_INTERVAL;
      mob.getPathfinder().moveTo(point, SPEED);
    }
  }

  @Override
  public GoalKey<Mob> getKey() {
    return KEY;
  }

  @Override
  public EnumSet<GoalType> getTypes() {
    return EnumSet.of(GoalType.MOVE, GoalType.JUMP, GoalType.LOOK);
  }
}
