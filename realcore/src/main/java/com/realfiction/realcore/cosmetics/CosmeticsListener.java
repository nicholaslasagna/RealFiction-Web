package com.realfiction.realcore.cosmetics;

import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

public final class CosmeticsListener implements Listener {
  private final CosmeticsManager manager;

  public CosmeticsListener(CosmeticsManager manager) {
    this.manager = manager;
  }

  @EventHandler
  public void onClick(InventoryClickEvent event) {
    if (event.getInventory().getHolder() instanceof CosmeticsHolder holder) {
      manager.handleClick(event, holder);
    }
  }

  @EventHandler
  public void onDrag(InventoryDragEvent event) {
    if (event.getInventory().getHolder() instanceof CosmeticsHolder) {
      event.setCancelled(true);
    }
  }

  @EventHandler
  public void onJoin(PlayerJoinEvent event) {
    manager.applyPlayerCosmetics(event.getPlayer());
  }

  @EventHandler
  public void onQuit(PlayerQuitEvent event) {
    manager.onPlayerQuit(event.getPlayer().getUniqueId());
  }

  @EventHandler
  public void onWorldChange(PlayerChangedWorldEvent event) {
    manager.applyPlayerCosmetics(event.getPlayer());
  }
}
