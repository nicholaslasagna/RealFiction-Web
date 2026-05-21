package com.realfiction.realcore.cosmetics;

import java.util.Locale;

public enum CosmeticCategory {
  PETS("pets", "Pets"),
  PARTICLES("particles", "Particles"),
  TRAILS("trails", "Trails"),
  USERNAME_COLORS("username-colors", "Username Colors"),
  LOBBY_FLIGHT("lobby-flight", "Lobby Flight");

  private final String id;
  private final String displayName;

  CosmeticCategory(String id, String displayName) {
    this.id = id;
    this.displayName = displayName;
  }

  public String id() {
    return id;
  }

  public String displayName() {
    return displayName;
  }

  public static CosmeticCategory fromId(String id) {
    if (id == null) {
      return null;
    }
    String normalized = id.trim().toLowerCase(Locale.ROOT);
    for (CosmeticCategory category : values()) {
      if (category.id.equals(normalized)) {
        return category;
      }
    }
    return null;
  }
}
