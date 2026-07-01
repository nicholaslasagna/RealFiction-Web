package com.realfiction.realcore.halloween;

import java.util.Locale;
import org.bukkit.configuration.ConfigurationSection;

public record HerobrineAppearanceConfig(
    String mode,
    boolean fallbackToArmorStand,
    String skinOwner,
    int hideFromTabAfterTicks
) {
  public static final String MODE_PACKET_NPC = "packet_npc";
  public static final String MODE_ARMOR_STAND = "armor_stand";
  public static final String MODE_AUTO = "auto";

  public static HerobrineAppearanceConfig from(ConfigurationSection section, String legacyHeadOwner) {
    if (section == null) {
      return defaults(legacyHeadOwner);
    }
    return new HerobrineAppearanceConfig(
        normalizeMode(section.getString("mode", MODE_ARMOR_STAND)),
        section.getBoolean("fallbackToArmorStand", true),
        clean(section.getString("skinOwner", legacyHeadOwner), clean(legacyHeadOwner, "Herobrineee")),
        Math.max(1, Math.min(200, section.getInt("hideFromTabAfterTicks", 20)))
    );
  }

  public static HerobrineAppearanceConfig defaults(String legacyHeadOwner) {
    return new HerobrineAppearanceConfig(
        MODE_PACKET_NPC,
        true,
        clean(legacyHeadOwner, "Herobrineee"),
        20
    );
  }

  public boolean packetNpcRequested() {
    return MODE_PACKET_NPC.equals(mode);
  }

  public boolean armorStandRequested() {
    return MODE_ARMOR_STAND.equals(mode);
  }

  public boolean autoRequested() {
    return MODE_AUTO.equals(mode);
  }

  private static String normalizeMode(String value) {
    String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    return switch (normalized) {
      case MODE_PACKET_NPC -> MODE_PACKET_NPC;
      case MODE_ARMOR_STAND -> MODE_ARMOR_STAND;
      case MODE_AUTO -> MODE_AUTO;
      default -> MODE_ARMOR_STAND;
    };
  }

  private static String clean(String value, String fallback) {
    String cleaned = value == null ? "" : value.trim();
    return cleaned.isBlank() ? fallback : cleaned;
  }
}
