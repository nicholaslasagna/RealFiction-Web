package com.realfiction.realcore.menu;

import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;

/** Routes inventory events for RealCore menus to the {@link MenuService}. */
public final class MenuListener implements Listener {
  private final MenuService menuService;

  public MenuListener(MenuService menuService) {
    this.menuService = menuService;
  }

  @EventHandler
  public void onClick(InventoryClickEvent event) {
    if (event.getInventory().getHolder() instanceof MenuHolder) {
      menuService.handleClick(event);
    }
  }

  @EventHandler
  public void onDrag(InventoryDragEvent event) {
    if (event.getInventory().getHolder() instanceof MenuHolder) {
      event.setCancelled(true);
    }
  }
}
