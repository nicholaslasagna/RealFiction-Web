package com.realfiction.realcore.cosmetics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class CosmeticsConfigTest {
  @Test
  void emptyConfigProvidesSafeCosmeticDefaults() {
    CosmeticsConfig config = CosmeticsConfig.from(new YamlConfiguration());

    assertTrue(config.enabled());
    assertEquals("&aCosmetics", config.title());
    assertEquals(45, config.size());
    assertEquals("realfiction.pets.pack", config.categories().get(CosmeticCategory.PETS).permission());
    assertEquals("realfiction.particles.vault", config.categories().get(CosmeticCategory.PARTICLES).permission());
    assertEquals("realfiction.username.colors", config.categories().get(CosmeticCategory.USERNAME_COLORS).permission());
    assertEquals("realfiction.lobby.flight", config.categories().get(CosmeticCategory.LOBBY_FLIGHT).permission());
    assertFalse(config.options(CosmeticCategory.USERNAME_COLORS).isEmpty());
  }

  @Test
  void parsesCustomCategoryAndPermissionMapping() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        cosmetics:
          enabled: true
          gui:
            title: "&6Cosmetics"
            size: 37
          categories:
            username-colors:
              enabled: true
              name: "&bNames"
              material: NAME_TAG
              permission: "realfiction.username.colors"
          options:
            username-colors:
              purple:
                name: "&5Purple Name"
                material: PURPLE_DYE
                permission: "realfiction.username.colors"
                color: "&5"
        """);

    CosmeticsConfig config = CosmeticsConfig.from(yaml);
    CosmeticOption option = config.option(CosmeticCategory.USERNAME_COLORS, "purple");

    assertEquals("&6Cosmetics", config.title());
    assertEquals(45, config.size());
    assertNotNull(option);
    assertEquals("realfiction.username.colors", option.permission());
    assertEquals("&5", option.colorCode());
  }
}
