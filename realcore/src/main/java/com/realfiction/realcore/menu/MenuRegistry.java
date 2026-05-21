package com.realfiction.realcore.menu;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.logging.Logger;
import org.bukkit.configuration.ConfigurationSection;

/** Parses and holds all configured menus. Rebuilt on reload. */
public final class MenuRegistry {
  private final Map<String, MenuDefinition> menus;

  private MenuRegistry(Map<String, MenuDefinition> menus) {
    this.menus = menus;
  }

  public static MenuRegistry from(ConfigurationSection menusSection, Logger logger) {
    Map<String, MenuDefinition> result = new LinkedHashMap<>();
    if (menusSection != null) {
      for (String id : menusSection.getKeys(false)) {
        ConfigurationSection menu = menusSection.getConfigurationSection(id);
        if (menu == null) {
          continue;
        }
        try {
          MenuDefinition definition = parseMenu(id, menu);
          result.put(definition.id(), definition);
        } catch (RuntimeException error) {
          if (logger != null) {
            logger.warning("RealCore skipped invalid menu '" + id + "': " + error.getMessage());
          }
        }
      }
    }
    return new MenuRegistry(result);
  }

  private static MenuDefinition parseMenu(String id, ConfigurationSection menu) {
    String title = menu.getString("title", "&aMenu");
    int size = normalizeSize(menu.getInt("size", 27));
    String fillerMaterial = menu.getString("filler.material", null);
    String fillerName = menu.getString("filler.name", " ");

    List<MenuItemSpec> items = new ArrayList<>();
    ConfigurationSection itemsSection = menu.getConfigurationSection("items");
    if (itemsSection != null) {
      for (String key : itemsSection.getKeys(false)) {
        ConfigurationSection item = itemsSection.getConfigurationSection(key);
        if (item == null) {
          continue;
        }
        int slot = item.getInt("slot", -1);
        if (slot < 0 || slot >= size) {
          continue;
        }
        String material = item.getString("material", "STONE");
        String name = item.getString("name", "");
        List<String> lore = item.getStringList("lore");
        boolean glow = item.getBoolean("glow", false);
        int amount = Math.max(1, item.getInt("amount", 1));
        List<MenuAction> actions = MenuActionParser.parseAll(item.getStringList("actions"));
        items.add(new MenuItemSpec(slot, material, name, lore, glow, amount, actions));
      }
    }
    return new MenuDefinition(id.toLowerCase(Locale.ROOT), title, size, fillerMaterial, fillerName, List.copyOf(items));
  }

  static int normalizeSize(int requested) {
    int size = requested;
    if (size < 9) {
      size = 9;
    }
    if (size % 9 != 0) {
      size = ((size / 9) + 1) * 9;
    }
    return Math.min(54, size);
  }

  public MenuDefinition get(String id) {
    return id == null ? null : menus.get(id.toLowerCase(Locale.ROOT));
  }

  public boolean has(String id) {
    return get(id) != null;
  }

  public int count() {
    return menus.size();
  }

  public List<String> keys() {
    return List.copyOf(menus.keySet());
  }
}
