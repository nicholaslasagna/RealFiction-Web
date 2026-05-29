package com.realfiction.realcore.cosmetics.pets;

import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.entity.EntityType;

/** Built-in cosmetic pet behavior (lobby-only, no gameplay). */
public record PetDefinition(
    String id,
    EntityType entityType,
    PetDisplayMode displayMode,
    PetFollowStyle followStyle,
    Particle ambientParticle,
    Material displayHead,
    boolean floating,
    float scale
) {
  public boolean displayPet() {
    return displayMode == PetDisplayMode.DISPLAY;
  }
  public enum PetFollowStyle {
    /** Trails slightly behind the player. */
    FOLLOW,
    /** Slow orbit around the player. */
    ORBIT,
    /** Gentle hover offset above follow position. */
    FLOAT
  }

  public float effectiveScale() {
    return scale <= 0f ? 1f : scale;
  }
}
