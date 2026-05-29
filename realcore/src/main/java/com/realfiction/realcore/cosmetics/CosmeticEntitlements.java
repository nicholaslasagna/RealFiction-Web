package com.realfiction.realcore.cosmetics;

import java.util.Map;
import java.util.Set;

/** Maps cosmetic LuckPerms permissions to player-facing unlock labels. */
public final class CosmeticEntitlements {
  private static final Map<String, String> LABELS = Map.of(
      CosmeticsConstants.PERM_PETS, "&aPets Pack",
      CosmeticsConstants.PERM_PARTICLES, "&bParticle Vault",
      CosmeticsConstants.PERM_USERNAME_COLORS, "&dUsername Colors",
      CosmeticsConstants.PERM_LOBBY_FLIGHT, "&bLobby Flight",
      CosmeticsConstants.PERM_ATELIER, "&dAtelier Cosmetics",
      CosmeticsConstants.PERM_US250_FOUNDER, "&cFounding 250 Cosmetics"
  );

  private static final Set<String> KNOWN = Set.copyOf(LABELS.keySet());

  private CosmeticEntitlements() {
  }

  public static boolean isCosmeticPermission(String permission) {
    return permission != null && KNOWN.contains(permission.trim());
  }

  public static String displayLabel(String permission) {
    if (permission == null) {
      return "&7Cosmetic";
    }
    return LABELS.getOrDefault(permission.trim(), "&7Cosmetic");
  }

  public static Set<String> knownPermissions() {
    return KNOWN;
  }
}
