package com.realfiction.realcore.config;

import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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
    Map<String, List<String>> commandsByProductSlug
) {
  public static RealCoreConfig from(FileConfiguration config) {
    URI baseUrl = URI.create(trimTrailingSlash(config.getString("baseUrl", "https://realfiction.live")));
    validateBaseUrl(baseUrl);
    String serverId = cleanString(config, "serverId", "lobby-1");
    String serverGroup = cleanString(config, "serverGroup", "global");
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
        readStringListMap(config.getConfigurationSection("rewards.commands.byProductSlug"))
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
