package com.realfiction.realcore.halloween;

import java.util.function.Supplier;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityCombustEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityTargetEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerArmorStandManipulateEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerInteractAtEntityEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.event.world.ChunkLoadEvent;
import org.bukkit.projectiles.ProjectileSource;

/** Keeps Herobrine sightings atmospheric only: no damage, targeting, or interaction. */
public final class HerobrineStalkerListener implements Listener {
  private final Supplier<HerobrineStalkerService> serviceSupplier;

  public HerobrineStalkerListener(Supplier<HerobrineStalkerService> serviceSupplier) {
    this.serviceSupplier = serviceSupplier;
  }

  @EventHandler(ignoreCancelled = true)
  public void onDamage(EntityDamageEvent event) {
    if (isHerobrine(event.getEntity())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onCombat(EntityDamageByEntityEvent event) {
    suppressIfPlayer(event.getEntity(), "combat");
    suppressIfPlayer(event.getDamager(), "combat");
    if (event.getDamager() instanceof Projectile projectile) {
      ProjectileSource shooter = projectile.getShooter();
      if (shooter instanceof Player player) {
        suppress(player, "combat");
      }
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

  @EventHandler
  public void onPlayerQuit(PlayerQuitEvent event) {
    suppress(event.getPlayer(), "player quit");
  }

  @EventHandler(ignoreCancelled = true)
  public void onPlayerTeleport(PlayerTeleportEvent event) {
    suppress(event.getPlayer(), "teleport");
  }

  @EventHandler
  public void onPlayerChangedWorld(PlayerChangedWorldEvent event) {
    suppress(event.getPlayer(), "world changed");
  }

  @EventHandler
  public void onPlayerDeath(PlayerDeathEvent event) {
    suppress(event.getEntity(), "player death");
  }

  @EventHandler
  public void onPlayerRespawn(PlayerRespawnEvent event) {
    suppress(event.getPlayer(), "respawn");
  }

  @EventHandler
  public void onPlayerJoin(PlayerJoinEvent event) {
    suppress(event.getPlayer(), "join/loading");
  }

  @EventHandler
  public void onChunkLoad(ChunkLoadEvent event) {
    HerobrineStalkerService service = service();
    if (service != null) {
      service.cleanupChunk(event.getChunk(), "chunk load");
      return;
    }
    for (Entity entity : event.getChunk().getEntities()) {
      if (isHerobrine(entity)) {
        entity.remove();
      }
    }
  }

  private boolean isHerobrine(Entity entity) {
    return entity != null && entity.getScoreboardTags().contains(HerobrineStalkerService.SCOREBOARD_TAG);
  }

  private void suppressIfPlayer(Entity entity, String reason) {
    if (entity instanceof Player player) {
      suppress(player, reason);
    }
  }

  private void suppress(Player player, String reason) {
    HerobrineStalkerService service = service();
    if (service != null) {
      service.suppressPlayer(player, reason);
    }
  }

  private HerobrineStalkerService service() {
    return serviceSupplier == null ? null : serviceSupplier.get();
  }
}
