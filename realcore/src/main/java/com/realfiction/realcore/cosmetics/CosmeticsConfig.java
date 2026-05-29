package com.realfiction.realcore.cosmetics;

import com.realfiction.realcore.cosmetics.pets.PetCosmetics;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.FileConfiguration;

public record CosmeticsConfig(
    boolean enabled,
    String title,
    int size,
    Map<CosmeticCategory, CategorySettings> categories,
    Map<CosmeticCategory, List<CosmeticOption>> options
) {
  public record CategorySettings(boolean enabled, String displayName, String material, String permission) {
  }

  public static CosmeticsConfig from(FileConfiguration config) {
    boolean enabled = config.getBoolean("cosmetics.enabled", true);
    String title = config.getString("cosmetics.gui.title", "&aCosmetics");
    int size = normalizeSize(config.getInt("cosmetics.gui.size", 45));

    Map<CosmeticCategory, CategorySettings> categories = new EnumMap<>(CosmeticCategory.class);
    for (CosmeticCategory category : CosmeticCategory.values()) {
      String path = "cosmetics.categories." + category.id();
      categories.put(category, new CategorySettings(
          config.getBoolean(path + ".enabled", true),
          config.getString(path + ".name", category.displayName()),
          config.getString(path + ".material", defaultMaterial(category)),
          config.getString(path + ".permission", defaultPermission(category))
      ));
    }

    Map<CosmeticCategory, List<CosmeticOption>> options = new EnumMap<>(CosmeticCategory.class);
    for (CosmeticCategory category : CosmeticCategory.values()) {
      options.put(category, parseOptions(config.getConfigurationSection("cosmetics.options." + category.id()), category));
    }
    PetCosmetics.mergeMissingBuiltins(options);

    return new CosmeticsConfig(enabled, title, size, Map.copyOf(categories), Map.copyOf(options));
  }

  public List<CosmeticOption> options(CosmeticCategory category) {
    return options.getOrDefault(category, List.of());
  }

  public CosmeticOption option(CosmeticCategory category, String id) {
    if (id == null || id.isBlank()) {
      return null;
    }
    String normalized = id.trim().toLowerCase(Locale.ROOT);
    for (CosmeticOption option : options(category)) {
      if (option.id().equals(normalized)) {
        return option;
      }
    }
    return null;
  }

  private static List<CosmeticOption> parseOptions(ConfigurationSection section, CosmeticCategory category) {
    List<CosmeticOption> parsed = new ArrayList<>();
    if (section == null) {
      return defaultOptions(category);
    }
    for (String key : section.getKeys(false)) {
      ConfigurationSection item = section.getConfigurationSection(key);
      if (item == null) {
        continue;
      }
      parsed.add(new CosmeticOption(
          key.toLowerCase(Locale.ROOT),
          category,
          item.getString("name", key),
          item.getString("material", defaultMaterial(category)),
          item.getString("permission", defaultPermission(category)),
          item.getStringList("lore"),
          item.getString("color", ""),
          item.getString("particle", ""),
          item.getBoolean("placeholder", false)
      ));
    }
    return parsed.isEmpty() ? defaultOptions(category) : List.copyOf(parsed);
  }

  private static List<CosmeticOption> defaultOptions(CosmeticCategory category) {
    return switch (category) {
      // Real, selectable pets (no "coming soon" placeholder). The same builtin
      // catalog is also merged in by PetCosmetics.mergeMissingBuiltins().
      case PETS -> PetCosmetics.builtinOptions();
      case PARTICLES -> List.of(new CosmeticOption("emerald-aura", category, "&aEmerald Aura", "EMERALD",
          "realfiction.particles.vault", List.of("&7A soft lobby sparkle."), "", "HAPPY_VILLAGER", false));
      case TRAILS -> List.of(new CosmeticOption("cloud-trail", category, "&fCloud Trail", "FEATHER",
          "realfiction.particles.vault", List.of("&7A light trail as you move."), "", "CLOUD", false));
      case USERNAME_COLORS -> List.of(
          new CosmeticOption("green", category, "&aGreen Name", "LIME_DYE", "realfiction.username.colors", List.of(), "&a", "", false),
          new CosmeticOption("gold", category, "&6Gold Name", "GOLD_INGOT", "realfiction.username.colors", List.of(), "&6", "", false),
          new CosmeticOption("aqua", category, "&bAqua Name", "DIAMOND", "realfiction.username.colors", List.of(), "&b", "", false)
      );
      case LOBBY_FLIGHT -> List.of(new CosmeticOption("toggle", category, "&bLobby Flight", "FEATHER",
          "realfiction.lobby.flight", List.of("&7Turn lobby flight on or off."), "", "", false));
    };
  }

  private static String defaultPermission(CosmeticCategory category) {
    return switch (category) {
      case PETS -> "realfiction.pets.pack";
      case PARTICLES, TRAILS -> "realfiction.particles.vault";
      case USERNAME_COLORS -> "realfiction.username.colors";
      case LOBBY_FLIGHT -> "realfiction.lobby.flight";
    };
  }

  private static String defaultMaterial(CosmeticCategory category) {
    return switch (category) {
      case PETS -> "BONE";
      case PARTICLES -> "EMERALD";
      case TRAILS -> "FEATHER";
      case USERNAME_COLORS -> "NAME_TAG";
      case LOBBY_FLIGHT -> "ELYTRA";
    };
  }

  public Map<CosmeticCategory, Integer> categorySlots() {
    Map<CosmeticCategory, Integer> slots = new LinkedHashMap<>();
    slots.put(CosmeticCategory.PETS, 11);
    slots.put(CosmeticCategory.PARTICLES, 12);
    slots.put(CosmeticCategory.TRAILS, 13);
    slots.put(CosmeticCategory.USERNAME_COLORS, 14);
    slots.put(CosmeticCategory.LOBBY_FLIGHT, 15);
    return slots;
  }

  private static int normalizeSize(int requested) {
    int size = requested;
    if (size < 9) {
      size = 9;
    }
    if (size % 9 != 0) {
      size = ((size / 9) + 1) * 9;
    }
    return Math.min(54, size);
  }
}
