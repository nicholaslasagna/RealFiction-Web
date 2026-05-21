package com.realfiction.realcore.cosmetics;

import java.util.List;

public record CosmeticOption(
    String id,
    CosmeticCategory category,
    String displayName,
    String material,
    String permission,
    List<String> lore,
    String colorCode,
    String particle,
    boolean placeholder
) {
  public boolean requiresPermission() {
    return permission != null && !permission.isBlank();
  }
}
