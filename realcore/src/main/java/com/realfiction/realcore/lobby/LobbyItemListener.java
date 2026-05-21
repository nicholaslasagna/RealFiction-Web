package com.realfiction.realcore.lobby;

import com.realfiction.realcore.lobby.LobbyConfig.LobbyItem;
import com.realfiction.realcore.menu.MenuHolder;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;

/** Handles right-click usage of lobby items and keeps them locked in place. */
public final class LobbyItemListener implements Listener {
  private final LobbyManager manager;

  public LobbyItemListener(LobbyManager manager) {
    this.manager = manager;
  }

  @EventHandler
  public void onInteract(PlayerInteractEvent event) {
    Action action = event.getAction();
    if (action != Action.RIGHT_CLICK_AIR && action != Action.RIGHT_CLICK_BLOCK) {
      return;
    }
    if (event.getHand() != EquipmentSlot.HAND) {
      return;
    }
    ItemStack item = event.getItem();
    String id = manager.lobbyItemService().itemIdOf(item);
    if (id == null) {
      return;
    }
    // This is a RealCore lobby item: never let it act as a normal item.
    event.setCancelled(true);

    Player player = event.getPlayer();
    LobbyConfig config = manager.config();
    for (LobbyItem lobbyItem : config.items()) {
      if (lobbyItem.id().equals(id)) {
        activate(player, lobbyItem, config);
        return;
      }
    }
  }

  private void activate(Player player, LobbyItem item, LobbyConfig config) {
    if (item.isMenu()) {
      manager.menuService().open(player, item.menuId());
    } else if (item.isVisibility()) {
      manager.visibilityService().toggle(player, item.cooldownSeconds());
      manager.lobbyItemService().refreshDynamic(player, config);
    }
  }

  @EventHandler
  public void onDrop(PlayerDropItemEvent event) {
    if (manager.lobbyItemService().itemIdOf(event.getItemDrop().getItemStack()) != null) {
      event.setCancelled(true);
    }
  }

  @EventHandler
  public void onClick(InventoryClickEvent event) {
    if (event.getInventory().getHolder() instanceof MenuHolder) {
      return; // menu clicks handled by MenuListener
    }
    if (!(event.getWhoClicked() instanceof Player)) {
      return;
    }
    if (manager.lobbyItemService().itemIdOf(event.getCurrentItem()) != null
        || manager.lobbyItemService().itemIdOf(event.getCursor()) != null) {
      event.setCancelled(true);
    }
  }
}
