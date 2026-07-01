package com.realfiction.realcore.halloween;

import org.bukkit.configuration.ConfigurationSection;

/**
 * Guarded config for persistent (real-block) Herobrine omen structures.
 *
 * <p>Disabled by default. Even when enabled it only takes effect together with
 * {@code distantOmenStructure.persistentBlocks=true}; either flag false means the
 * omen stays particles-only. {@code maxBlocksPerStructure} is hard-capped at 16.
 */
public record HerobrinePersistentStructureConfig(
    boolean enabled,
    int maxPerWorld,
    int maxBlocksPerStructure,
    int minDistanceFromWorldSpawn,
    int minDistanceFromClaims,
    int minDistanceFromPlayerBeds,
    int minDistanceFromContainers,
    boolean requireNaturalTerrain,
    boolean restoreOriginalBlocks,
    boolean allowAdminCleanup,
    int maxCandidateChecks
) {
  public static HerobrinePersistentStructureConfig from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    return new HerobrinePersistentStructureConfig(
        section.getBoolean("enabled", false),
        Math.max(0, Math.min(64, section.getInt("maxPerWorld", 5))),
        Math.max(1, Math.min(16, section.getInt("maxBlocksPerStructure", 16))),
        Math.max(0, Math.min(2048, section.getInt("minDistanceFromWorldSpawn", 256))),
        Math.max(0, Math.min(128, section.getInt("minDistanceFromClaims", 32))),
        Math.max(0, Math.min(128, section.getInt("minDistanceFromPlayerBeds", 48))),
        Math.max(0, Math.min(128, section.getInt("minDistanceFromContainers", 32))),
        section.getBoolean("requireNaturalTerrain", true),
        section.getBoolean("restoreOriginalBlocks", true),
        section.getBoolean("allowAdminCleanup", true),
        Math.max(1, Math.min(128, section.getInt("maxCandidateChecks", 64)))
    );
  }

  public static HerobrinePersistentStructureConfig defaults() {
    return new HerobrinePersistentStructureConfig(
        false,
        5,
        16,
        256,
        32,
        48,
        32,
        true,
        true,
        true,
        64
    );
  }
}
