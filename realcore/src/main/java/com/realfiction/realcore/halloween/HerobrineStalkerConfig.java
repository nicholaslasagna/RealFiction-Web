package com.realfiction.realcore.halloween;

import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;
import org.bukkit.configuration.ConfigurationSection;

public record HerobrineStalkerConfig(
    boolean enabled,
    boolean dryRun,
    HalloweenEventWindow dateWindow,
    Set<String> worldAllowlist,
    Set<String> worldDenylist,
    Set<String> serverAllowlist,
    Set<String> serverDenylist,
    double chancePerCheck,
    Duration checkInterval,
    Duration perPlayerCooldown,
    Duration globalCooldown,
    int minSpawnDistance,
    int maxSpawnDistance,
    Duration minLinger,
    Duration maxLinger,
    boolean vanishWhenSeen,
    double caveSoundChanceOnSpawn,
    double caveSoundChanceWhileStalking,
    double caveSoundChanceOnVanish,
    boolean requireNightRainMiningOrDarkness,
    boolean debug,
    String headOwner
) {
  public static HerobrineStalkerConfig from(ConfigurationSection section) {
    if (section == null) {
      return defaults();
    }
    ConfigurationSection date = section.getConfigurationSection("dateWindow");
    HalloweenEventWindow window = new HalloweenEventWindow(
        clampMonth(date == null ? 10 : date.getInt("startMonth", 10)),
        clampDay(date == null ? 15 : date.getInt("startDay", 15)),
        clampMonth(date == null ? 11 : date.getInt("endMonth", 11)),
        clampDay(date == null ? 1 : date.getInt("endDay", 1))
    );
    int minDistance = Math.max(8, section.getInt("minSpawnDistance", 24));
    int maxDistance = Math.max(minDistance, section.getInt("maxSpawnDistance", 48));
    long minLinger = Math.max(1L, section.getLong("minLingerSeconds", 5));
    long maxLinger = Math.max(minLinger, section.getLong("maxLingerSeconds", 12));
    return new HerobrineStalkerConfig(
        section.getBoolean("enabled", true),
        section.getBoolean("dryRun", false),
        window,
        lowerSet(section.getStringList("worlds.allowlist")),
        lowerSet(section.getStringList("worlds.denylist")),
        lowerSet(section.getStringList("servers.allowlist")),
        lowerSet(section.getStringList("servers.denylist")),
        clampChance(section.getDouble("chancePerCheck", 0.015)),
        Duration.ofSeconds(Math.max(5L, section.getLong("checkIntervalSeconds", 45))),
        Duration.ofSeconds(Math.max(1L, section.getLong("perPlayerCooldownSeconds", 600))),
        Duration.ofSeconds(Math.max(1L, section.getLong("globalCooldownSeconds", 45))),
        minDistance,
        maxDistance,
        Duration.ofSeconds(minLinger),
        Duration.ofSeconds(maxLinger),
        section.getBoolean("vanishWhenSeen", true),
        clampChance(section.getDouble("caveSoundChanceOnSpawn", 0.15)),
        clampChance(section.getDouble("caveSoundChanceWhileStalking", 0.08)),
        clampChance(section.getDouble("caveSoundChanceOnVanish", 0.25)),
        section.getBoolean("requireNightRainMiningOrDarkness", true),
        section.getBoolean("debug", false),
        clean(section.getString("headOwner", "Herobrine"), "Herobrine")
    );
  }

  public static HerobrineStalkerConfig defaults() {
    return new HerobrineStalkerConfig(
        true,
        false,
        HalloweenEventWindow.defaultWindow(),
        Set.of(),
        Set.of("lobby", "void_spawn", "lobby_games"),
        Set.of(),
        Set.of("lobby", "arcade"),
        0.015,
        Duration.ofSeconds(45),
        Duration.ofSeconds(600),
        Duration.ofSeconds(45),
        24,
        48,
        Duration.ofSeconds(5),
        Duration.ofSeconds(12),
        true,
        0.15,
        0.08,
        0.25,
        true,
        false,
        "Herobrine"
    );
  }

  public boolean worldAllowed(String worldName) {
    String value = normalize(worldName);
    if (value.isBlank()) {
      return false;
    }
    if (worldDenylist.contains(value)) {
      return false;
    }
    return worldAllowlist.isEmpty() || worldAllowlist.contains(value);
  }

  public boolean serverAllowed(String serverId, String serverGroup) {
    String id = normalize(serverId);
    String group = normalize(serverGroup);
    if (serverDenylist.contains(id) || serverDenylist.contains(group)) {
      return false;
    }
    return serverAllowlist.isEmpty() || serverAllowlist.contains(id) || serverAllowlist.contains(group);
  }

  private static Set<String> lowerSet(List<String> values) {
    if (values == null || values.isEmpty()) {
      return Set.of();
    }
    return values.stream()
        .map(HerobrineStalkerConfig::normalize)
        .filter(value -> !value.isBlank())
        .collect(Collectors.toUnmodifiableSet());
  }

  private static String normalize(String value) {
    return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
  }

  private static String clean(String value, String fallback) {
    String cleaned = value == null ? "" : value.trim();
    return cleaned.isBlank() ? fallback : cleaned;
  }

  private static double clampChance(double value) {
    if (Double.isNaN(value) || value < 0.0) {
      return 0.0;
    }
    return Math.min(1.0, value);
  }

  private static int clampMonth(int month) {
    return Math.max(1, Math.min(12, month));
  }

  private static int clampDay(int day) {
    return Math.max(1, Math.min(31, day));
  }
}
