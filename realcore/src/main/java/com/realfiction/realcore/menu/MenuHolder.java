package com.realfiction.realcore.menu;

import java.util.List;
import java.util.Map;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.jetbrains.annotations.NotNull;

/** Marks an inventory as a RealCore menu and maps slots to their actions. */
public final class MenuHolder implements InventoryHolder {
  private final String menuId;
  private final Map<Integer, List<MenuAction>> actionsBySlot;
  private Inventory inventory;

  public MenuHolder(String menuId, Map<Integer, List<MenuAction>> actionsBySlot) {
    this.menuId = menuId;
    this.actionsBySlot = actionsBySlot;
  }

  public String menuId() {
    return menuId;
  }

  public List<MenuAction> actionsFor(int slot) {
    return actionsBySlot.getOrDefault(slot, List.of());
  }

  void setInventory(Inventory inventory) {
    this.inventory = inventory;
  }

  @Override
  public @NotNull Inventory getInventory() {
    return inventory;
  }
}
