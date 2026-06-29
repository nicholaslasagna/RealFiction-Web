package com.realfiction.realcore.halloween;

import org.bukkit.entity.Entity;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityCombustEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityTargetEvent;
import org.bukkit.event.player.PlayerArmorStandManipulateEvent;
import org.bukkit.event.player.PlayerInteractAtEntityEvent;

/** Keeps Herobrine sightings atmospheric only: no damage, targeting, or interaction. */
public final class HerobrineStalkerListener implements Listener {
  @EventHandler(ignoreCancelled = true)
  public void onDamage(EntityDamageEvent event) {
    if (isHerobrine(event.getEntity())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onArmorStandManipulate(PlayerArmorStandManipulateEvent event) {
    if (isHerobrine(event.getRightClicked())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onInteract(PlayerInteractAtEntityEvent event) {
    if (isHerobrine(event.getRightClicked())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onTarget(EntityTargetEvent event) {
    if (isHerobrine(event.getEntity()) || isHerobrine(event.getTarget())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onCombust(EntityCombustEvent event) {
    if (isHerobrine(event.getEntity())) {
      event.setCancelled(true);
    }
  }

  private boolean isHerobrine(Entity entity) {
    return entity != null && entity.getScoreboardTags().contains(HerobrineStalkerService.SCOREBOARD_TAG);
  }
}
