package com.realfiction.realcore.menu;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class MenuRegistryTest {
  @Test
  void normalizesMenuSizeToMultiplesOfNine() {
    assertEquals(9, MenuRegistry.normalizeSize(0));
    assertEquals(9, MenuRegistry.normalizeSize(5));
    assertEquals(18, MenuRegistry.normalizeSize(10));
    assertEquals(27, MenuRegistry.normalizeSize(27));
    assertEquals(54, MenuRegistry.normalizeSize(54));
    assertEquals(54, MenuRegistry.normalizeSize(100));
  }

  @Test
  void exposesLoadedMenuKeys() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        menus:
          game-menu:
            title: "&aGame Menu"
            size: 27
          lobby-selector:
            title: "&aLobby Selector"
            size: 27
        """);

    MenuRegistry registry = MenuRegistry.from(yaml.getConfigurationSection("menus"), null);

    assertEquals(2, registry.count());
    assertTrue(registry.keys().contains("game-menu"));
    assertTrue(registry.keys().contains("lobby-selector"));
  }
}
