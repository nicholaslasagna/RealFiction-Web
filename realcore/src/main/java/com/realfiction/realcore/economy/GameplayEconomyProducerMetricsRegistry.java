package com.realfiction.realcore.economy;

import java.util.Collection;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-producer gameplay economy capture metrics. Each producer id gets an isolated counter set.
 */
public final class GameplayEconomyProducerMetricsRegistry {
  private final ConcurrentHashMap<String, GameplayEconomyProducerMetrics> byProducerId = new ConcurrentHashMap<>();

  public GameplayEconomyProducerMetrics forProducer(String producerId) {
    if (producerId == null || producerId.isBlank()) {
      throw new IllegalArgumentException("producerId is required");
    }
    return byProducerId.computeIfAbsent(producerId, ignored -> new GameplayEconomyProducerMetrics());
  }

  public Collection<String> producerIds() {
    return byProducerId.keySet();
  }

  public Map<String, GameplayEconomyProducerMetrics> snapshotByProducerId() {
    return Map.copyOf(byProducerId);
  }

  public GameplayEconomyProducerMetrics aggregate() {
    GameplayEconomyProducerMetrics total = new GameplayEconomyProducerMetrics();
    for (GameplayEconomyProducerMetrics metrics : byProducerId.values()) {
      total.mergeFrom(metrics);
    }
    return total;
  }
}
