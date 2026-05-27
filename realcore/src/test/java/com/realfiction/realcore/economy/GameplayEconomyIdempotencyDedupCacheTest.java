package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import org.junit.jupiter.api.Test;

final class GameplayEconomyIdempotencyDedupCacheTest {
  @Test
  void marksAbsentOnlyOnceWithinTtl() {
    GameplayEconomyIdempotencyDedupCache cache = new GameplayEconomyIdempotencyDedupCache(Duration.ofMinutes(5), 100);
    assertTrue(cache.markIfAbsent("gameplay:smp-1:shop_sell:test:uuid:event-1"));
    assertFalse(cache.markIfAbsent("gameplay:smp-1:shop_sell:test:uuid:event-1"));
  }
}
