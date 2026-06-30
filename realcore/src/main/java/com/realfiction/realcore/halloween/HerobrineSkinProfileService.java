package com.realfiction.realcore.halloween;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Logger;

public final class HerobrineSkinProfileService {
  public record SkinProfile(String owner, String value, String signature, Instant resolvedAt, String failureReason) {
    public boolean resolved() {
      return value != null && !value.isBlank();
    }

    public String status() {
      if (resolved()) {
        return "resolved:" + owner;
      }
      return "unresolved" + (failureReason == null || failureReason.isBlank() ? "" : ":" + failureReason);
    }
  }

  private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(5);

  private final HttpClient httpClient;
  private final Logger logger;
  private final Map<String, SkinProfile> cache = new ConcurrentHashMap<>();
  private final Map<String, AtomicBoolean> inFlight = new ConcurrentHashMap<>();

  public HerobrineSkinProfileService(Logger logger) {
    this(HttpClient.newBuilder().connectTimeout(REQUEST_TIMEOUT).build(), logger);
  }

  HerobrineSkinProfileService(HttpClient httpClient, Logger logger) {
    this.httpClient = Objects.requireNonNull(httpClient, "httpClient");
    this.logger = logger;
  }

  public void preload(String owner) {
    String key = key(owner);
    if (key.isBlank() || cache.containsKey(key)) {
      return;
    }
    AtomicBoolean loading = inFlight.computeIfAbsent(key, ignored -> new AtomicBoolean(false));
    if (!loading.compareAndSet(false, true)) {
      return;
    }
    CompletableFuture
        .supplyAsync(() -> resolveBlocking(owner))
        .whenComplete((profile, error) -> {
          try {
            if (error != null) {
              cache.put(key, unresolved(owner, shortError(error)));
              if (logger != null) {
                logger.fine("Could not resolve Herobrine skin owner " + owner + ": " + shortError(error));
              }
              return;
            }
            cache.put(key, profile);
          } finally {
            loading.set(false);
          }
        });
  }

  public SkinProfile cached(String owner) {
    String key = key(owner);
    if (key.isBlank()) {
      return unresolved(owner, "blank owner");
    }
    SkinProfile profile = cache.get(key);
    if (profile != null) {
      return profile;
    }
    preload(owner);
    return unresolved(owner, "lookup pending");
  }

  public String status(String owner) {
    return cached(owner).status();
  }

  private SkinProfile resolveBlocking(String owner) {
    String cleaned = clean(owner);
    if (cleaned.isBlank()) {
      return unresolved(owner, "blank owner");
    }
    try {
      HttpRequest profileRequest = HttpRequest.newBuilder()
          .uri(URI.create("https://api.mojang.com/users/profiles/minecraft/"
              + URLEncoder.encode(cleaned, StandardCharsets.UTF_8)))
          .timeout(REQUEST_TIMEOUT)
          .GET()
          .build();
      HttpResponse<String> profileResponse = httpClient.send(profileRequest, HttpResponse.BodyHandlers.ofString());
      if (profileResponse.statusCode() != 200 || profileResponse.body() == null || profileResponse.body().isBlank()) {
        return unresolved(cleaned, "profile " + profileResponse.statusCode());
      }
      JsonObject profileJson = JsonParser.parseString(profileResponse.body()).getAsJsonObject();
      String rawId = string(profileJson, "id");
      UUID uuid = parseMojangUuid(rawId);
      if (uuid == null) {
        return unresolved(cleaned, "invalid uuid");
      }

      HttpRequest sessionRequest = HttpRequest.newBuilder()
          .uri(URI.create("https://sessionserver.mojang.com/session/minecraft/profile/"
              + rawId + "?unsigned=false"))
          .timeout(REQUEST_TIMEOUT)
          .GET()
          .build();
      HttpResponse<String> sessionResponse = httpClient.send(sessionRequest, HttpResponse.BodyHandlers.ofString());
      if (sessionResponse.statusCode() != 200 || sessionResponse.body() == null || sessionResponse.body().isBlank()) {
        return unresolved(cleaned, "session " + sessionResponse.statusCode());
      }
      JsonObject sessionJson = JsonParser.parseString(sessionResponse.body()).getAsJsonObject();
      JsonArray properties = sessionJson.getAsJsonArray("properties");
      if (properties == null) {
        return unresolved(cleaned, "no properties");
      }
      for (JsonElement element : properties) {
        if (!element.isJsonObject()) {
          continue;
        }
        JsonObject property = element.getAsJsonObject();
        if (!"textures".equalsIgnoreCase(string(property, "name"))) {
          continue;
        }
        String value = string(property, "value");
        String signature = string(property, "signature");
        if (!value.isBlank()) {
          return new SkinProfile(cleaned, value, signature, Instant.now(), "");
        }
      }
      return unresolved(cleaned, "textures missing");
    } catch (IOException error) {
      return unresolved(cleaned, shortError(error));
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      return unresolved(cleaned, "interrupted");
    } catch (RuntimeException error) {
      return unresolved(cleaned, shortError(error));
    }
  }

  private static SkinProfile unresolved(String owner, String reason) {
    return new SkinProfile(clean(owner), "", "", Instant.now(), reason);
  }

  private static String key(String owner) {
    return clean(owner).toLowerCase(Locale.ROOT);
  }

  private static String clean(String value) {
    return value == null ? "" : value.trim();
  }

  private static String string(JsonObject object, String key) {
    if (object == null || !object.has(key) || object.get(key).isJsonNull()) {
      return "";
    }
    return object.get(key).getAsString();
  }

  private static UUID parseMojangUuid(String raw) {
    if (raw == null || raw.length() != 32) {
      return null;
    }
    try {
      return UUID.fromString(raw.replaceFirst(
          "(\\p{XDigit}{8})(\\p{XDigit}{4})(\\p{XDigit}{4})(\\p{XDigit}{4})(\\p{XDigit}+)",
          "$1-$2-$3-$4-$5"
      ));
    } catch (IllegalArgumentException error) {
      return null;
    }
  }

  private static String shortError(Throwable error) {
    String message = error.getMessage();
    return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
  }
}
