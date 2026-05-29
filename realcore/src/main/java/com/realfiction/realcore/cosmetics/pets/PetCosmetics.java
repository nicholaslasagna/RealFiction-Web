package com.realfiction.realcore.cosmetics.pets;

import com.realfiction.realcore.cosmetics.CosmeticCategory;
import com.realfiction.realcore.cosmetics.CosmeticOption;
import com.realfiction.realcore.cosmetics.CosmeticsConstants;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.entity.EntityType;

/** Built-in pet catalog merged into cosmetics config when missing. */
public final class PetCosmetics {
  private static final Map<String, PetDefinition> DEFINITIONS = buildDefinitions();

  private PetCosmetics() {
  }

  public static PetDefinition definition(String id) {
    if (id == null || id.isBlank()) {
      return null;
    }
    return DEFINITIONS.get(id.trim().toLowerCase(Locale.ROOT));
  }

  public static int definitionCount() {
    return DEFINITIONS.size();
  }

  public static void mergeMissingBuiltins(Map<CosmeticCategory, List<CosmeticOption>> options) {
    Map<CosmeticCategory, List<CosmeticOption>> mutable = new EnumMap<>(CosmeticCategory.class);
    for (CosmeticCategory category : CosmeticCategory.values()) {
      mutable.put(category, new ArrayList<>(options.getOrDefault(category, List.of())));
    }
    for (CosmeticOption builtin : builtinOptions()) {
      List<CosmeticOption> list = mutable.get(builtin.category());
      boolean exists = list.stream().anyMatch(option -> option.id().equals(builtin.id()));
      if (!exists) {
        list.add(builtin);
      }
    }
    for (CosmeticCategory category : CosmeticCategory.values()) {
      options.put(category, List.copyOf(mutable.get(category)));
    }
  }

  static List<CosmeticOption> builtinOptions() {
    return List.of(
        packPet("emerald-sprite", "&aEmerald Sprite", "ALLAY", CosmeticsConstants.PERM_PETS,
            List.of("&7A tiny magical green companion.", "&7Soft emerald sparkles.")),
        packPet("cloud-puff", "&fCloud Puff", "WHITE_WOOL", CosmeticsConstants.PERM_PETS,
            List.of("&7A soft cloud companion.", "&7Gentle floating wisps.")),
        packPet("fox-friend", "&6Fox Friend", "FOX_SPAWN_EGG", CosmeticsConstants.PERM_PETS,
            List.of("&7A warm loyal lobby friend.", "&7Occasional heart sparkles.")),
        packPet("snow-fox", "&fSnow Fox", "SNOWBALL", CosmeticsConstants.PERM_PETS,
            List.of("&7A frosty arctic fox.", "&7Snowflake sparkles.")),
        packPet("parrot-pal", "&eParrot Pal", "FEATHER", CosmeticsConstants.PERM_PETS,
            List.of("&7A chatty colorful companion.", "&7Musical note sparkles.")),
        packPet("bee-buzz", "&eBee Buzz", "HONEYCOMB", CosmeticsConstants.PERM_PETS,
            List.of("&7A friendly buzzing bee.", "&7Honey and wax glimmers.")),
        packPet("axolotl-splash", "&dAxolotl Splash", "TROPICAL_FISH", CosmeticsConstants.PERM_PETS,
            List.of("&7A playful water friend.", "&7Splash and bubble trails.")),
        packPet("bunny-hop", "&fBunny Hop", "RABBIT_FOOT", CosmeticsConstants.PERM_PETS,
            List.of("&7A bouncy baby bunny.", "&7Soft hop trail.")),
        packPet("tiny-dragon", "&dTiny Dragon", "DRAGON_HEAD", CosmeticsConstants.PERM_PETS,
            List.of("&7A miniature ender dragon.", "&7End-rod soul-fire glimmer.")),
        packPet("atelier-orb", "&dAtelier Orb", "END_CRYSTAL", CosmeticsConstants.PERM_ATELIER,
            List.of("&7Floating luxury orb.", "&7Enchant and end-rod radiance.", "&dAtelier Exclusive")),
        packPet("starlight-wisp", "&bStarlight Wisp", "NETHER_STAR", CosmeticsConstants.PERM_ATELIER,
            List.of("&7Celestial wisp with star-like particles.", "&dAtelier Exclusive")),
        packPet("moon-moth", "&5Moon Moth", "PHANTOM_MEMBRANE", CosmeticsConstants.PERM_ATELIER,
            List.of("&7A gentle night moth.", "&7Soft purple glimmer.", "&dAtelier Exclusive")),
        packPet("liberty-eagle", "&cLiberty &fEagle &9250", "FEATHER", CosmeticsConstants.PERM_US250_FOUNDER,
            List.of("&7Patriotic companion.", "&7Red, white, and blue trail.", "&cFounding 250 Exclusive")),
        new CosmeticOption(
            "pet-pack",
            CosmeticCategory.PETS,
            "&aPets Pack",
            "BONE",
            CosmeticsConstants.PERM_PETS,
            List.of("&7Legacy pack entry — choose a companion below."),
            "",
            "",
            true
        )
    );
  }

  private static CosmeticOption packPet(
      String id,
      String name,
      String material,
      String permission,
      List<String> lore
  ) {
    return new CosmeticOption(id, CosmeticCategory.PETS, name, material, permission, lore, "", "", false);
  }

  private static Map<String, PetDefinition> buildDefinitions() {
    Map<String, PetDefinition> map = new java.util.LinkedHashMap<>();
    map.put("emerald-sprite", def("emerald-sprite", EntityType.ALLAY, PetDisplayMode.MOB, PetDefinition.PetFollowStyle.FLOAT,
        Particle.HAPPY_VILLAGER, Material.EMERALD, true, 1f));
    map.put("cloud-puff", def("cloud-puff", EntityType.ARMOR_STAND, PetDisplayMode.DISPLAY, PetDefinition.PetFollowStyle.FLOAT,
        Particle.CLOUD, Material.WHITE_WOOL, true, 1f));
    map.put("fox-friend", def("fox-friend", EntityType.FOX, PetDisplayMode.MOB, PetDefinition.PetFollowStyle.FOLLOW,
        Particle.HEART, Material.SWEET_BERRIES, false, 0.85f));
    map.put("snow-fox", def("snow-fox", EntityType.FOX, PetDisplayMode.MOB, PetDefinition.PetFollowStyle.FOLLOW,
        Particle.SNOWFLAKE, Material.SNOWBALL, false, 0.85f));
    map.put("parrot-pal", def("parrot-pal", EntityType.PARROT, PetDisplayMode.MOB, PetDefinition.PetFollowStyle.FLOAT,
        Particle.ENCHANT, Material.FEATHER, true, 0.75f));
    map.put("bee-buzz", def("bee-buzz", EntityType.BEE, PetDisplayMode.MOB, PetDefinition.PetFollowStyle.ORBIT,
        Particle.WAX_ON, Material.HONEYCOMB, true, 0.7f));
    map.put("axolotl-splash", def("axolotl-splash", EntityType.AXOLOTL, PetDisplayMode.MOB, PetDefinition.PetFollowStyle.FLOAT,
        Particle.SPLASH, Material.TROPICAL_FISH, true, 0.8f));
    map.put("bunny-hop", def("bunny-hop", EntityType.RABBIT, PetDisplayMode.MOB, PetDefinition.PetFollowStyle.FOLLOW,
        Particle.CRIT, Material.RABBIT_FOOT, false, 0.65f));
    map.put("tiny-dragon", def("tiny-dragon", EntityType.ARMOR_STAND, PetDisplayMode.DISPLAY,
        PetDefinition.PetFollowStyle.ORBIT, Particle.END_ROD, Material.DRAGON_HEAD, true, 1f));
    map.put("atelier-orb", def("atelier-orb", EntityType.ARMOR_STAND, PetDisplayMode.DISPLAY, PetDefinition.PetFollowStyle.ORBIT,
        Particle.ENCHANT, Material.END_CRYSTAL, true, 1f));
    map.put("starlight-wisp", def("starlight-wisp", EntityType.ARMOR_STAND, PetDisplayMode.DISPLAY, PetDefinition.PetFollowStyle.ORBIT,
        Particle.END_ROD, Material.NETHER_STAR, true, 1f));
    map.put("moon-moth", def("moon-moth", EntityType.BAT, PetDisplayMode.MOB, PetDefinition.PetFollowStyle.ORBIT,
        Particle.WITCH, Material.PHANTOM_MEMBRANE, true, 0.55f));
    map.put("liberty-eagle", def("liberty-eagle", EntityType.ARMOR_STAND, PetDisplayMode.DISPLAY, PetDefinition.PetFollowStyle.FOLLOW,
        Particle.DUST, Material.FEATHER, false, 1f));
    return Map.copyOf(map);
  }

  private static PetDefinition def(
      String id,
      EntityType type,
      PetDisplayMode displayMode,
      PetDefinition.PetFollowStyle style,
      Particle particle,
      Material head,
      boolean floating,
      float scale
  ) {
    return new PetDefinition(id, type, displayMode, style, particle, head, floating, scale);
  }
}
