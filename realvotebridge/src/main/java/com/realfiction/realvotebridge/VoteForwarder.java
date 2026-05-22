package com.realfiction.realvotebridge;

import java.io.Closeable;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import org.slf4j.Logger;

public final class VoteForwarder implements Closeable {
  private static final String VOTE_PATH = "/api/vote";

  private final BridgeConfig config;
  private final Logger logger;
  private final HttpClient httpClient;

  public VoteForwarder(BridgeConfig config, Logger logger) {
    this.config = config;
    this.logger = logger;
    this.httpClient = HttpClient.newBuilder()
        .connectTimeout(config.requestTimeout())
        .build();
  }

  public CompletableFuture<Void> forward(VotePayload payload) {
    String rawBody = payload.toJson();
    long timestamp = System.currentTimeMillis();
    String nonce = HmacSigner.nonce();
    String message = HmacSigner.signedMessage(config.serverId(), timestamp, nonce, "POST", VOTE_PATH, rawBody);
    String signature = HmacSigner.sign(config.hmacSecret(), message);

    HttpRequest request = HttpRequest.newBuilder(config.resolve(VOTE_PATH))
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
        .thenAccept(response -> handleResponse(payload, response));
  }

  private void handleResponse(VotePayload payload, HttpResponse<String> response) {
    if (response.statusCode() >= 200 && response.statusCode() < 300) {
      logger.info(
          "Vote forwarded: player={} site={} rewardQueued={}",
          payload.minecraftUsername(),
          payload.site(),
          response.body() != null && response.body().contains("\"rewardQueued\":true")
      );
      return;
    }

    logger.warn(
        "Vote forward failed: player={} site={} http={} body={}",
        payload.minecraftUsername(),
        payload.site(),
        response.statusCode(),
        truncate(response.body())
    );
  }

  private String truncate(String value) {
    if (value == null || value.isBlank()) {
      return "";
    }
    return value.length() > 220 ? value.substring(0, 220) : value;
  }

  @Override
  public void close() {
    // HttpClient owns no explicit close hook on Java 21.
  }
}
