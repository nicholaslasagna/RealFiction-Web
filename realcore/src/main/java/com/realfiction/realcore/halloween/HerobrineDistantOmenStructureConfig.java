package com.realfiction.realcore.halloween;

import java.time.Duration;
import java.util.Locale;
import org.bukkit.configuration.ConfigurationSection;

public record HerobrineDistantOmenStructureConfig(
    boolean enabled,
    double chance,
    int minDistance,
    int maxDistance,
    Duration linger,
    String type,
    boolean particlesOnly,
    boolean packetFakeBlocks,
    boolean persistentBlocks,
    boolean requireOpenSky,
    int minOpenRadius,
    int minHeightClearance,
    int avoidPlayerBaseBlocksRadius,
    int maxCandidateChecks,
    int minDistanceFromWorldSpawn,
    int maxBlocksPlaced,
    boolean trackPlacements,
    boolean allowRestoreCommand
) {
  public static HerobrineDistantOmenStructureConfig from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    int minDistance = Math.max(24, Math.min(160, section.getInt("minDistance", 36)));
    int maxDistance = Math.max(minDistance, Math.min(192, section.getInt("maxDistance", 72)));
    return new HerobrineDistantOmenStructureConfig(
        section.getBoolean("enabled", true),
        HerobrineStalkerRules.clampChance(section.getDouble("chance", 0.01)),
        minDistance,
        maxDistance,
        Duration.ofSeconds(Math.max(1L, Math.min(12L, section.getLong("lingerSeconds", 5)))),
        cleanType(section.getString("type", section.getString("structureType", "void_monolith"))),
        section.getBoolean("particlesOnly", true),
        section.getBoolean("packetFakeBlocks", false),
        section.getBoolean("persistentBlocks", false),
        section.getBoolean("requireOpenSky", true),
        Math.max(2, Math.min(8, section.getInt("minOpenRadius", 5))),
        Math.max(3, Math.min(12, section.getInt("minHeightClearance", 8))),
        Math.max(0, Math.min(32, section.getInt("avoidPlayerBaseBlocksRadius", 8))),
        Math.max(1, Math.min(64, section.getInt("maxCandidateChecks", 32))),
        Math.max(0, Math.min(512, section.getInt("minDistanceFromWorldSpawn", 128))),
        Math.max(0, Math.min(12, section.getInt("maxBlocksPlaced", 0))),
        section.getBoolean("trackPlacements", true),
        section.getBoolean("allowRestoreCommand", false)
    );
  }

  public static HerobrineDistantOmenStructureConfig defaults() {
    return new HerobrineDistantOmenStructureConfig(
        true,
        0.01,
        36,
        72,
        Duration.ofSeconds(5),
        "void_monolith",
        true,
        false,
        false,
        true,
        5,
        8,
        8,
        32,
        128,
        0,
        true,
        false
    );
  }

  public boolean realBlockPlacementRequested() {
    return persistentBlocks || !particlesOnly;
  }

  private static String cleanType(String value) {
    String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    return switch (normalized) {
      case "void_monolith", "ash_silhouette", "smoke_column" -> normalized;
      default -> "void_monolith";
    };
  }
}
