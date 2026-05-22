package com.realfiction.realcore.api;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.realfiction.realcore.api.dto.AckRewardsRequest;
import com.realfiction.realcore.api.dto.AckRewardsResponse;
import com.realfiction.realcore.api.dto.HeartbeatRequest;
import com.realfiction.realcore.api.dto.HeartbeatResponse;
import com.realfiction.realcore.api.dto.LinkConfirmRequest;
import com.realfiction.realcore.api.dto.LinkConfirmResponse;
import com.realfiction.realcore.api.dto.PollRewardsRequest;
import com.realfiction.realcore.api.dto.PollRewardsResponse;
import com.realfiction.realcore.config.RealCoreConfig;
import java.io.Closeable;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.logging.Logger;

public final class PlatformApiClient implements Closeable {
  private final RealCoreConfig config;
  private final Logger logger;
  private final Gson gson = new Gson();
  private final HttpClient httpClient;

  public PlatformApiClient(RealCoreConfig config, Logger logger) {
    this.config = config;
    this.logger = logger;
    this.httpClient = HttpClient.newBuilder()
        .connectTimeout(config.requestTimeout())
        .build();
  }

  public CompletableFuture<LinkConfirmResponse> confirmLink(LinkConfirmRequest request) {
    return post("/api/plugin/account-link/confirm", request, LinkConfirmResponse.class);
  }

  public CompletableFuture<PollRewardsResponse> pollRewards(PollRewardsRequest request) {
    return post("/api/plugin/rewards/poll", request, PollRewardsResponse.class);
  }

  public CompletableFuture<AckRewardsResponse> ackRewards(AckRewardsRequest request) {
    return post("/api/plugin/rewards/ack", request, AckRewardsResponse.class);
  }

  public CompletableFuture<HeartbeatResponse> heartbeat(HeartbeatRequest request) {
    return post("/api/plugin/server/heartbeat", request, HeartbeatResponse.class);
  }

  private <T> CompletableFuture<T> post(String path, Object payload, Class<T> responseType) {
    String rawBody = gson.toJson(payload);
    URI uri = config.baseUrl().resolve(path);
    long timestamp = System.currentTimeMillis();
    String nonce = HmacSigner.nonce();
    String signedMessage = HmacSigner.signedMessage(config.serverId(), timestamp, nonce, "POST", path, rawBody);
    String signature = HmacSigner.sign(config.hmacSecret(), signedMessage);

    HttpRequest request = HttpRequest.newBuilder(uri)
        .timeout(config.requestTimeout().plus(Duration.ofSeconds(2)))
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .header("x-realfiction-plugin-server-id", config.serverId())
        .header("x-realfiction-plugin-timestamp", Long.toString(timestamp))
        .header("x-realfiction-plugin-nonce", nonce)
        .header("x-realfiction-plugin-signature", signature)
        .POST(HttpRequest.BodyPublishers.ofString(rawBody))
        .build();

    return httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString())
        .thenApply(response -> {
          // Log the exact HTTP status + (truncated) response body for API calls.
          // Always for >=400; on debug for everything. Response bodies carry no
          // secrets (the HMAC is request-side), so this is safe to log and makes
          // a failing ack/poll diagnosable directly from the server console.
          if (logger != null && (config.debug() || response.statusCode() >= 400)) {
            logger.info("API " + path + " -> HTTP " + response.statusCode() + " body=" + truncateBody(response.body()));
          }
          return parseResponse(response, responseType);
        });
  }

  private static String truncateBody(String body) {
    if (body == null || body.isBlank()) {
      return "";
    }
    String trimmed = body.strip();
    return trimmed.length() > 500 ? trimmed.substring(0, 500) + "..." : trimmed;
  }

  private <T> T parseResponse(HttpResponse<String> response, Class<T> responseType) {
    if (response.statusCode() >= 200 && response.statusCode() < 300) {
      return gson.fromJson(response.body(), responseType);
    }

    String message = "RealFiction API returned HTTP " + response.statusCode();
    try {
      JsonObject json = gson.fromJson(response.body(), JsonObject.class);
      if (json != null && json.has("error")) {
        message = json.get("error").getAsString();
      }
    } catch (RuntimeException ignored) {
      // Keep the generic HTTP message.
    }
    throw new PlatformApiException(message, response.statusCode());
  }

  @Override
  public void close() {
    // HttpClient manages its own async resources.
  }
}
