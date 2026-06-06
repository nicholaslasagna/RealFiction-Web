package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.economy.EconomyBalanceCache.LoadState;
import com.realfiction.realcore.economy.EconomyBalanceCache.MutationResult;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class EconomyBalanceCacheTest {
  private final EconomyBalanceCache cache = new EconomyBalanceCache();
  private final UUID id = UUID.randomUUID();

  @Test
  void unknownAccountIsAbsentAndServesNothing() {
    assertEquals(LoadState.ABSENT, cache.state(id));
    assertFalse(cache.isLoaded(id));
    assertTrue(cache.balanceMinor(id).isEmpty());
  }

  @Test
  void loadedAccountServesItsBalance() {
    cache.putLoaded(id, 5_000);
    assertTrue(cache.isLoaded(id));
    assertEquals(5_000, cache.balanceMinor(id).orElseThrow());
  }

  @Test
  void failedLoadServesNothingAndRejectsMutations() {
    cache.markFailed(id);
    assertEquals(LoadState.FAILED, cache.state(id));
    assertTrue(cache.balanceMinor(id).isEmpty());
    assertEquals(MutationResult.NOT_LOADED, cache.deposit(id, 100).result());
    assertEquals(MutationResult.NOT_LOADED, cache.withdraw(id, 100).result());
  }

  @Test
  void depositAddsToLoadedBalance() {
    cache.putLoaded(id, 1_000);
    EconomyBalanceCache.Mutation mutation = cache.deposit(id, 250);
    assertTrue(mutation.ok());
    assertEquals(1_250, mutation.balanceMinor());
    assertEquals(1_250, cache.balanceMinor(id).orElseThrow());
  }

  @Test
  void withdrawSucceedsWhenSufficient() {
    cache.putLoaded(id, 1_000);
    EconomyBalanceCache.Mutation mutation = cache.withdraw(id, 400);
    assertTrue(mutation.ok());
    assertEquals(600, mutation.balanceMinor());
    assertEquals(600, cache.balanceMinor(id).orElseThrow());
  }

  @Test
  void withdrawRejectedWhenInsufficientAndBalanceUnchanged() {
    cache.putLoaded(id, 300);
    EconomyBalanceCache.Mutation mutation = cache.withdraw(id, 500);
    assertEquals(MutationResult.INSUFFICIENT_FUNDS, mutation.result());
    assertEquals(300, cache.balanceMinor(id).orElseThrow());
  }

  @Test
  void mutationsOnUnknownAccountAreNotLoaded() {
    assertEquals(MutationResult.NOT_LOADED, cache.deposit(id, 100).result());
    assertEquals(MutationResult.NOT_LOADED, cache.withdraw(id, 100).result());
  }

  @Test
  void evictionMakesAccountAbsentAgain() {
    cache.putLoaded(id, 1_000);
    cache.evict(id);
    assertEquals(LoadState.ABSENT, cache.state(id));
  }

  @Test
  void negativeAmountsAreRejected() {
    cache.putLoaded(id, 1_000);
    assertThrows(IllegalArgumentException.class, () -> cache.deposit(id, -1));
    assertThrows(IllegalArgumentException.class, () -> cache.withdraw(id, -1));
  }
}
