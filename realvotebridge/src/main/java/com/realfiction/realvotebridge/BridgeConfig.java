package com.realfiction.realvotebridge;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public record BridgeConfig(
    boolean enabled,
    URI baseUrl,
    String serverId,
    String hmacSecret,
    Duration requestTimeout,
    boolean debug
) {
  public static BridgeConfig load(Path dataDirectory) throws IOException {
    Files.createDirectories(dataDirectory);
    Path configPath = dataDirectory.resolve("config.yml");
    if (Files.notExists(configPath)) {
      try (InputStream stream = BridgeConfig.class.getResourceAsStream("/config.yml")) {
        if (stream == null) {
          throw new IOException("Bundled config.yml is missing.");
        }
        Files.writeString(configPath, new String(stream.readAllBytes(), StandardCharsets.UTF_8), StandardCharsets.UTF_8);
      }
    }
    return parse(Files.readString(configPath, StandardCharsets.UTF_8));
  }

  public static BridgeConfig parse(String raw) {
    Map<String, String> values = new HashMap<>();
    for (String line : raw.split("\\R")) {
      String trimmed = line.trim();
      if (trimmed.isBlank() || trimmed.startsWith("#") || !trimmed.contains(":")) {
        continue;
      }
      int split = trimmed.indexOf(':');
      String key = trimmed.substring(0, split).trim();
      String value = stripQuotes(trimmed.substring(split + 1).trim());
      values.put(key, value);
    }

    boolean enabled = Boolean.parseBoolean(values.getOrDefault("enabled", "true"));
    URI baseUrl = URI.create(require(values, "baseUrl")).normalize();
    String serverId = require(values, "serverId");
    String hmacSecret = require(values, "hmacSecret");
    int timeoutSeconds = Integer.parseInt(values.getOrDefault("requestTimeoutSeconds", "10"));
    boolean debug = Boolean.parseBoolean(values.getOrDefault("debug", "false"));

    return new BridgeConfig(enabled, baseUrl, serverId, hmacSecret, Duration.ofSeconds(Math.max(1, timeoutSeconds)), debug);
  }

  public boolean ready() {
    return enabled
        && baseUrl != null
        && hasText(serverId)
        && hasText(hmacSecret)
        && !"CHANGE_ME".equalsIgnoreCase(hmacSecret.trim());
  }

  public URI resolve(String path) {
    return baseUrl.resolve(path);
  }

  private static String require(Map<String, String> values, String key) {
    String value = values.get(key);
    if (!hasText(value)) {
      throw new IllegalArgumentException(key + " is required.");
    }
    return value;
  }

  private static String stripQuotes(String value) {
    if (value.length() >= 2) {
      char first = value.charAt(0);
      char last = value.charAt(value.length() - 1);
      if ((first == '"' && last == '"') || (first == '\'' && last == '\'')) {
        return value.substring(1, value.length() - 1);
      }
    }
    return value;
  }

  private static boolean hasText(String value) {
    return value != null && !value.isBlank();
  }

  public BridgeConfig {
    Objects.requireNonNull(requestTimeout, "requestTimeout");
  }
}
