package com.realfiction.realcore.lobby;

import com.realfiction.realcore.item.ItemFactory;
import com.realfiction.realcore.lobby.LobbyConfig.LobbyItem;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/** Builds and places lobby hotbar items, tagging them with a PDC id. */
public final class LobbyItemService {
  private final RealCoreScheduler scheduler;
  private final VisibilityService visibility;
  private final NamespacedKey itemKey;

  public LobbyItemService(Plugin plugin, RealCoreScheduler scheduler, VisibilityService visibility) {
    this.scheduler = scheduler;
    this.visibility = visibility;
    this.itemKey = new NamespacedKey(plugin, "lobby_item");
  }

  public void give(Player player, LobbyConfig config) {
    if (!config.join().giveItems()) {
      return;
    }
    scheduler.runForPlayer(player, () -> {
      PlayerInventory inventory = player.getInventory();
      for (LobbyItem item : config.items()) {
        inventory.setItem(item.hotbarIndex(), build(item, player));
      }
    });
  }

  /** Re-renders any visibility item so its icon matches the player's state. */
  public void refreshDynamic(Player player, LobbyConfig config) {
    scheduler.runForPlayer(player, () -> {
      PlayerInventory inventory = player.getInventory();
      for (LobbyItem item : config.items()) {
        if (item.isVisibility()) {
          inventory.setItem(item.hotbarIndex(), build(item, player));
        }
      }
    });
  }

  public ItemStack build(LobbyItem item, Player player) {
    String material;
    String name;
    if (item.isVisibility()) {
      boolean see = visibility.seeOthers(player);
      material = see ? item.onMaterial() : item.offMaterial();
      name = see ? item.onName() : item.offName();
    } else {
      material = item.material();
      name = item.name();
    }

    ItemStack stack = ItemFactory.build(material, name, item.lore(), item.glow(), 1, player);
    ItemMeta meta = stack.getItemMeta();
    if (meta != null) {
      meta.getPersistentDataContainer().set(itemKey, PersistentDataType.STRING, item.id());
      stack.setItemMeta(meta);
    }
    return stack;
  }

  public String itemIdOf(ItemStack stack) {
    if (stack == null) {
      return null;
    }
    ItemMeta meta = stack.getItemMeta();
    if (meta == null) {
      return null;
    }
    return meta.getPersistentDataContainer().get(itemKey, PersistentDataType.STRING);
  }
}
