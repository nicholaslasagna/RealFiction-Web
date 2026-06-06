package com.realfiction.realcore.economy;

import java.util.OptionalLong;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Thread-safe in-memory balance cache backing the RealCore Vault economy provider.
 *
 * <p>Vault's {@code getBalance} is synchronous, so balances are served from here. Entries are
 * preloaded from the authoritative store (Supabase) when a player joins and updated write-through
 * on every change. A <em>failed</em> load is recorded distinctly from a real zero balance, so the
 * provider can <b>fail closed</b> (reject economy operations) rather than hand out free money or
 * silently wipe a balance when the store is briefly unreachable.
 *
 * <p>All balances are in integer minor units ({@code $1.00 == 100}).
 */
public final class EconomyBalanceCache {
  public enum LoadState {
    /** Authoritative balance is known and trustworthy. */
    LOADED,
    /** A load was attempted but failed; the provider must fail closed for this account. */
    FAILED,
    /** Nothing is known about this account (never preloaded). */
    ABSENT
  }

  public enum MutationResult {
    OK,
    INSUFFICIENT_FUNDS,
    NOT_LOADED
  }

  public record Entry(long balanceMinor, LoadState state, long updatedAtMillis) {}

  public record Mutation(MutationResult result, long balanceMinor) {
    public boolean ok() {
      return result == MutationResult.OK;
    }
  }

  private final ConcurrentHashMap<UUID, Entry> entries = new ConcurrentHashMap<>();

  /** Record (or refresh) a trustworthy authoritative balance. */
  public void putLoaded(UUID uuid, long balanceMinor) {
    entries.put(uuid, new Entry(Math.max(0L, balanceMinor), LoadState.LOADED, System.currentTimeMillis()));
  }

  /** Record that loading this account failed, so the provider fails closed for it. */
  public void markFailed(UUID uuid) {
    entries.put(uuid, new Entry(0L, LoadState.FAILED, System.currentTimeMillis()));
  }

  public void evict(UUID uuid) {
    entries.remove(uuid);
  }

  public LoadState state(UUID uuid) {
    Entry entry = entries.get(uuid);
    return entry == null ? LoadState.ABSENT : entry.state();
  }

  public boolean isLoaded(UUID uuid) {
    return state(uuid) == LoadState.LOADED;
  }

  public Entry entry(UUID uuid) {
    return entries.get(uuid);
  }

  /** Balance for a LOADED account, else empty (the caller decides the fail-closed behaviour). */
  public OptionalLong balanceMinor(UUID uuid) {
    Entry entry = entries.get(uuid);
    if (entry != null && entry.state() == LoadState.LOADED) {
      return OptionalLong.of(entry.balanceMinor());
    }
    return OptionalLong.empty();
  }

  public int size() {
    return entries.size();
  }

  /** Atomically add {@code amountMinor} (>= 0) to a LOADED account. */
  public Mutation deposit(UUID uuid, long amountMinor) {
    if (amountMinor < 0) {
      throw new IllegalArgumentException("deposit amount must be >= 0");
    }
    return mutate(uuid, amountMinor);
  }

  /** Atomically remove {@code amountMinor} (>= 0) from a LOADED account, never going negative. */
  public Mutation withdraw(UUID uuid, long amountMinor) {
    if (amountMinor < 0) {
      throw new IllegalArgumentException("withdraw amount must be >= 0");
    }
    return mutate(uuid, -amountMinor);
  }

  private Mutation mutate(UUID uuid, long deltaMinor) {
    AtomicReference<Mutation> outcome = new AtomicReference<>(new Mutation(MutationResult.NOT_LOADED, 0L));
    entries.computeIfPresent(uuid, (id, entry) -> {
      if (entry.state() != LoadState.LOADED) {
        outcome.set(new Mutation(MutationResult.NOT_LOADED, entry.balanceMinor()));
        return entry;
      }
      long next = entry.balanceMinor() + deltaMinor;
      if (next < 0) {
        outcome.set(new Mutation(MutationResult.INSUFFICIENT_FUNDS, entry.balanceMinor()));
        return entry;
      }
      outcome.set(new Mutation(MutationResult.OK, next));
      return new Entry(next, LoadState.LOADED, System.currentTimeMillis());
    });
    return outcome.get();
  }
}
