package com.realfiction.realcore.economy;

import java.time.Duration;
import java.time.Instant;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Bounded TTL cache preventing duplicate producer captures from plugin quirks.
 */
public final class GameplayEconomyIdempotencyDedupCache {
  private final long ttlMillis;
  private final int maxEntries;
  private final Map<String, Long> entries = new LinkedHashMap<>(16, 0.75f, true);

  public GameplayEconomyIdempotencyDedupCache(Duration ttl, int maxEntries) {
    this.ttlMillis = Math.max(1, ttl.toMillis());
    this.maxEntries = Math.max(1, maxEntries);
  }

  public synchronized boolean markIfAbsent(String idempotencyKey) {
    if (idempotencyKey == null || idempotencyKey.isBlank()) {
      return false;
    }
    evictExpired();
    if (entries.containsKey(idempotencyKey)) {
      return false;
    }
    entries.put(idempotencyKey, Instant.now().toEpochMilli());
    trimToMax();
    return true;
  }

  public synchronized int size() {
    evictExpired();
    return entries.size();
  }

  private void evictExpired() {
    long cutoff = Instant.now().toEpochMilli() - ttlMillis;
    Iterator<Map.Entry<String, Long>> iterator = entries.entrySet().iterator();
    while (iterator.hasNext()) {
      Map.Entry<String, Long> entry = iterator.next();
      if (entry.getValue() < cutoff) {
        iterator.remove();
      }
    }
  }

  private void trimToMax() {
    while (entries.size() > maxEntries) {
      Iterator<String> iterator = entries.keySet().iterator();
      if (!iterator.hasNext()) {
        break;
      }
      iterator.next();
      iterator.remove();
    }
  }
}
