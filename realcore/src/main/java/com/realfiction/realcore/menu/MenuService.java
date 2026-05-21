package com.realfiction.realcore.menu;

import com.realfiction.realcore.item.ItemFactory;
import com.realfiction.realcore.proxy.ProxyService;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.text.Text;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.Plugin;

/** Opens config-driven menus and runs their actions through the scheduler. */
public final class MenuService {
  private final Plugin plugin;
  private final RealCoreScheduler scheduler;
  private final ProxyService proxyService;
  private final Supplier<MenuRegistry> registry;

  public MenuService(Plugin plugin, RealCoreScheduler scheduler, ProxyService proxyService, Supplier<MenuRegistry> registry) {
    this.plugin = plugin;
    this.scheduler = scheduler;
    this.proxyService = proxyService;
    this.registry = registry;
  }

  public boolean open(Player player, String menuId) {
    MenuRegistry current = registry.get();
    MenuDefinition definition = current == null ? null : current.get(menuId);
    if (definition == null) {
      scheduler.send(player, ChatColor.RED + "That menu is not available right now.");
      return false;
    }
    scheduler.runForPlayer(player, () -> openNow(player, definition));
    return true;
  }

  private void openNow(Player player, MenuDefinition definition) {
    Map<Integer, List<MenuAction>> actionsBySlot = new HashMap<>();
    MenuHolder holder = new MenuHolder(definition.id(), actionsBySlot);
    Inventory inventory = Bukkit.createInventory(holder, definition.size(), Text.color(definition.title()));
    holder.setInventory(inventory);

    if (definition.fillerMaterial() != null && !definition.fillerMaterial().isBlank()) {
      ItemStack filler = ItemFactory.build(definition.fillerMaterial(), definition.fillerName(), List.of(), false, 1);
      for (int slot = 0; slot < definition.size(); slot++) {
        inventory.setItem(slot, filler);
      }
    }

    for (MenuItemSpec spec : definition.items()) {
      if (spec.slot() < 0 || spec.slot() >= definition.size()) {
        continue;
      }
      inventory.setItem(spec.slot(), ItemFactory.build(spec.material(), spec.name(), spec.lore(), spec.glow(), spec.amount()));
      actionsBySlot.put(spec.slot(), spec.actions());
    }

    player.openInventory(inventory);
  }

  public void handleClick(InventoryClickEvent event) {
    if (!(event.getInventory().getHolder() instanceof MenuHolder holder)) {
      return;
    }
    event.setCancelled(true);
    if (!(event.getWhoClicked() instanceof Player player)) {
      return;
    }
    int slot = event.getRawSlot();
    if (slot < 0 || slot >= event.getInventory().getSize()) {
      return;
    }
    List<MenuAction> actions = holder.actionsFor(slot);
    if (!actions.isEmpty()) {
      executeActions(player, actions);
    }
  }

  public void executeActions(Player player, List<MenuAction> actions) {
    for (MenuAction action : actions) {
      execute(player, action);
    }
  }

  private void execute(Player player, MenuAction action) {
    switch (action.type()) {
      case CLOSE_INVENTORY -> scheduler.runForPlayer(player, player::closeInventory);
      case MESSAGE -> scheduler.send(player, Text.color(apply(player, action.value())));
      case CONSOLE_COMMAND -> dispatchConsole(apply(player, action.value()));
      case PLAYER_COMMAND -> {
        String command = apply(player, action.value());
        scheduler.runForPlayer(player, () -> player.performCommand(command));
      }
      case PROXY -> proxyService.connect(player, action.value());
    }
  }

  private void dispatchConsole(String command) {
    scheduler.dispatchConsoleCommand(command).exceptionally(error -> {
      plugin.getLogger().warning("RealCore menu console command failed (" + command + "): " + error.getMessage());
      return null;
    });
  }

  private String apply(Player player, String input) {
    if (input == null) {
      return "";
    }
    return input
        .replace("%player%", player.getName())
        .replace("%uuid%", player.getUniqueId().toString());
  }
}
