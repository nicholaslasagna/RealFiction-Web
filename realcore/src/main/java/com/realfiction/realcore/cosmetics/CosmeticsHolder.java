package com.realfiction.realcore.cosmetics;

import java.util.Map;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.jetbrains.annotations.NotNull;

public final class CosmeticsHolder implements InventoryHolder {
  public enum View {
    ROOT,
    CATEGORY
  }

  private final View view;
  private final CosmeticCategory category;
  private final Map<Integer, String> actions;
  private Inventory inventory;

  public CosmeticsHolder(View view, CosmeticCategory category, Map<Integer, String> actions) {
    this.view = view;
    this.category = category;
    this.actions = actions;
  }

  public View view() {
    return view;
  }

  public CosmeticCategory category() {
    return category;
  }

  public String action(int slot) {
    return actions.get(slot);
  }

  void setInventory(Inventory inventory) {
    this.inventory = inventory;
  }

  @Override
  public @NotNull Inventory getInventory() {
    return inventory;
  }
}
