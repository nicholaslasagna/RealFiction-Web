package com.realfiction.realcore.item;

import com.realfiction.realcore.text.Text;
import java.util.List;
import org.bukkit.Material;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.inventory.ItemFlag;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

/** Builds display ItemStacks for lobby hotbar items and menu icons. */
public final class ItemFactory {
  private ItemFactory() {
  }

  public static Material material(String name, Material fallback) {
    if (name == null || name.isBlank()) {
      return fallback;
    }
    Material material = Material.matchMaterial(name.trim().toUpperCase(java.util.Locale.ROOT));
    return material == null ? fallback : material;
  }

  public static ItemStack build(String materialName, String displayName, List<String> lore, boolean glow, int amount) {
    Material material = material(materialName, Material.STONE);
    ItemStack item = new ItemStack(material, Math.max(1, amount));
    ItemMeta meta = item.getItemMeta();
    if (meta == null) {
      return item;
    }
    if (displayName != null && !displayName.isBlank()) {
      meta.setDisplayName(Text.color(displayName));
    }
    if (lore != null && !lore.isEmpty()) {
      meta.setLore(Text.color(lore));
    }
    if (glow) {
      meta.addEnchant(Enchantment.UNBREAKING, 1, true);
      meta.addItemFlags(ItemFlag.HIDE_ENCHANTS);
    }
    item.setItemMeta(meta);
    return item;
  }
}
