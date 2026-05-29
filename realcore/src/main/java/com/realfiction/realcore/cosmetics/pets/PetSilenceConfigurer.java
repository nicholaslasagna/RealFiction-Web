package com.realfiction.realcore.cosmetics.pets;

import org.bukkit.entity.Allay;
import org.bukkit.entity.Bat;
import org.bukkit.entity.Bee;
import org.bukkit.entity.EnderDragon;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Parrot;

/** Ensures cosmetic pets never play mob or ambient sounds. */
final class PetSilenceConfigurer {
  private PetSilenceConfigurer() {
  }

  static void apply(Entity entity) {
    if (entity == null) {
      return;
    }
    entity.setSilent(true);
    if (!(entity instanceof LivingEntity living)) {
      return;
    }
    if (living instanceof Mob mob) {
      mob.setAware(false);
      living.setAI(false);
    }
    switch (living) {
      case Allay allay -> {
        allay.setCanPickupItems(false);
        allay.setCanDuplicate(false);
      }
      case Parrot parrot -> clearParrotImitation(parrot);
      case Bat bat -> bat.setAwake(false);
      case Bee bee -> {
        bee.setAnger(0);
        bee.setHasStung(false);
      }
      case EnderDragon dragon -> {
        dragon.setPhase(EnderDragon.Phase.HOVER);
        setEnderDragonInactive(dragon);
      }
      default -> {
        // no extra rules
      }
    }
  }

  private static void clearParrotImitation(Parrot parrot) {
    try {
      parrot.getClass().getMethod("setImitating", org.bukkit.entity.LivingEntity.class).invoke(parrot, new Object[] {null});
    } catch (ReflectiveOperationException ignored) {
      // API may not expose imitation control on this version
    }
  }

  private static void setEnderDragonInactive(EnderDragon dragon) {
    try {
      dragon.getClass().getMethod("setActive", boolean.class).invoke(dragon, false);
    } catch (ReflectiveOperationException ignored) {
      // Paper exposes setActive on supported builds
    }
  }
}
