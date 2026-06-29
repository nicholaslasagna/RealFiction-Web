package com.realfiction.realcore.config;

import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import com.realfiction.realcore.halloween.HalloweenConfig;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.FileConfiguration;

public record RealCoreConfig(
    URI baseUrl,
    String serverId,
    String serverGroup,
    String hmacSecret,
    Duration pollInterval,
    Duration requestTimeout,
    int pollLimit,
    boolean debug,
    List<String> capabilities,
    String linkPlatform,
    boolean allowUnsafeRewards,
    Map<String, String> productPermissions,
    Map<String, List<String>> commandsByRewardKey,
    Map<String, List<String>> commandsByProductSlug,
    Map<String, List<String>> playerMessagesByRewardKey,
    boolean rewardBroadcastsEnabled,
    Map<String, List<String>> broadcastMessagesByRewardKey,
    RewardEconomyConfig rewardEconomy,
    String displayName,
    boolean refuseOnDuplicateServerId,
    ServerModules modules,
    Set<String> skipUsernames,
    EconomyConfig economy,
    HalloweenConfig halloween
) {
  public static RealCoreConfig from(FileConfiguration config) {
    URI baseUrl = URI.create(trimTrailingSlash(config.getString("baseUrl", "https://realfiction.live")));
    validateBaseUrl(baseUrl);
    // Prefer the nested server.* block; fall back to the legacy flat keys so an
    // existing deployed config keeps working unchanged.
    String serverId = firstNonBlank(config.getString("server.id"), config.getString("serverId"), "lobby-1");
    String serverGroup = firstNonBlank(config.getString("server.group"), config.getString("serverGroup"), "global");
    String displayName = firstNonBlank(config.getString("server.displayName"), config.getString("displayName"), serverId);
    boolean refuseOnDuplicateServerId = config.getBoolean("server.refuseOnDuplicate", false);
    ServerModules modules = ServerModules.from(config.getConfigurationSection("modules"));
    // Usernames whose votes are placeholders/tests (e.g. PlanetMinecraft "PMC")
    // and must never run reward commands. Absent key defaults to ["pmc"]; an
    // explicit (even empty) list disables/overrides the default.
    Set<String> skipUsernames = new HashSet<>();
    if (config.isList("rewards.skipUsernames")) {
      for (String name : config.getStringList("rewards.skipUsernames")) {
        if (name != null && !name.isBlank()) {
          skipUsernames.add(name.trim().toLowerCase(Locale.ROOT));
        }
      }
    } else {
      skipUsernames.add("pmc");
    }
    String hmacSecret = cleanString(config, "hmacSecret", "");
    if (serverId.isBlank()) {
      throw new IllegalArgumentException("serverId must not be blank.");
    }
    if (serverGroup.isBlank()) {
      throw new IllegalArgumentException("serverGroup must not be blank.");
    }
    Duration pollInterval = Duration.ofSeconds(Math.max(5, config.getLong("pollIntervalSeconds", 30)));
    Duration requestTimeout = Duration.ofSeconds(Math.max(2, config.getLong("requestTimeoutSeconds", 10)));
    int pollLimit = Math.max(1, Math.min(100, config.getInt("pollLimit", 25)));
    boolean debug = config.getBoolean("debug", false);
    List<String> capabilities = config.getStringList("capabilities");
    if (capabilities.isEmpty()) {
      capabilities = List.of("luckperms", "cosmetics", "vote_rewards", "console_commands");
    }
    String linkPlatform = config.getString("linking.platform", "java").toLowerCase(Locale.ROOT);
    boolean allowUnsafeRewards = config.getBoolean("rewards.allowUnsafeRewards", false);

    return new RealCoreConfig(
        baseUrl,
        serverId,
        serverGroup,
        hmacSecret,
        pollInterval,
        requestTimeout,
        pollLimit,
        debug,
        List.copyOf(capabilities),
        linkPlatform,
        allowUnsafeRewards,
        readStringMap(config.getConfigurationSection("rewards.productPermissions")),
        readStringListMap(config.getConfigurationSection("rewards.commands.byRewardKey")),
        readStringListMap(config.getConfigurationSection("rewards.commands.byProductSlug")),
        readStringListMap(config.getConfigurationSection("rewards.messages.player.byRewardKey")),
        config.getBoolean("rewards.messages.broadcast.enabled", false),
        readStringListMap(config.getConfigurationSection("rewards.messages.broadcast.byRewardKey")),
        RewardEconomyConfig.from(config.getConfigurationSection("rewards.economy")),
        displayName,
        refuseOnDuplicateServerId,
        modules,
        Set.copyOf(skipUsernames),
        EconomyConfig.from(config.getConfigurationSection("economy")),
        HalloweenConfig.from(config.getConfigurationSection("halloween"))
    );
  }

  public boolean hmacSecretConfigured() {
    return !hmacSecret.isBlank() && !"CHANGE_ME".equals(hmacSecret);
  }

  private static String trimTrailingSlash(String value) {
    String trimmed = value == null ? "" : value.trim();
    while (trimmed.endsWith("/")) {
      trimmed = trimmed.substring(0, trimmed.length() - 1);
    }
    return trimmed.isBlank() ? "https://realfiction.live" : trimmed;
  }

  private static String cleanString(FileConfiguration config, String path, String defaultValue) {
    String value = config.getString(path);
    return value == null ? defaultValue.trim() : value.trim();
  }

  private static String firstNonBlank(String... values) {
    for (String value : values) {
      if (value != null && !value.isBlank()) {
        return value.trim();
      }
    }
    return "";
  }

  private static void validateBaseUrl(URI baseUrl) {
    String scheme = baseUrl.getScheme();
    if (!baseUrl.isAbsolute() || scheme == null || (!scheme.equalsIgnoreCase("https") && !scheme.equalsIgnoreCase("http"))) {
      throw new IllegalArgumentException("baseUrl must start with https:// or http://.");
    }
  }

  private static Map<String, String> readStringMap(ConfigurationSection section) {
    Map<String, String> values = new HashMap<>();
    if (section == null) {
      return values;
    }
    for (String key : section.getKeys(false)) {
      String value = section.getString(key);
      if (value != null && !value.isBlank()) {
        values.put(key, value.trim());
      }
    }
    return values;
  }

  private static Map<String, List<String>> readStringListMap(ConfigurationSection section) {
    Map<String, List<String>> values = new HashMap<>();
    if (section == null) {
      return values;
    }
    readStringListMap(section, "", values);
    return values;
  }

  private static void readStringListMap(ConfigurationSection section, String prefix, Map<String, List<String>> values) {
    for (String key : section.getKeys(false)) {
      String mapKey = prefix.isBlank() ? key : prefix + "." + key;
      if (section.isConfigurationSection(key)) {
        readStringListMap(section.getConfigurationSection(key), mapKey, values);
        continue;
      }

      List<String> commands = new ArrayList<>(section.getStringList(key));
      commands.removeIf(String::isBlank);
      if (!commands.isEmpty()) {
        values.put(mapKey, List.copyOf(commands));
      }
    }
  }
}
