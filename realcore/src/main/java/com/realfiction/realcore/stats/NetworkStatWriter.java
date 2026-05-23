package com.realfiction.realcore.stats;

import java.util.UUID;

/**
 * Generic, Folia-safe write API for network stats.
 *
 * <p>Producers (vote/kill/death/blocks/economy listeners) call {@link #increment}
 * or {@link #set} from any thread. Implementations buffer in memory and flush
 * asynchronously - producers never block on disk or network I/O.
 *
 * <p>Implementations must:
 * <ul>
 *   <li>Be safe to call from any region/main/scheduler thread.</li>
 *   <li>Touch nothing except concurrent in-memory data structures on the call path.</li>
 *   <li>Handle a {@code null} or blank {@code statKey} / {@code subject} as a no-op.</li>
 * </ul>
 */
public interface NetworkStatWriter {
  /**
   * Add a non-negative delta to a counter-style stat (e.g. votes, kills,
   * blocks_broken). Implementations must clamp negative deltas to zero so a
   * misbehaving producer cannot debit a counter.
   */
  void increment(String statKey, UUID subject, String displayName, long delta);

  /**
   * Mirror an absolute value (e.g. money balance). May go up or down between
   * calls; the latest value wins.
   */
  void set(String statKey, UUID subject, String displayName, double value);

  /** Force a flush of buffered events. Returns immediately; the flush runs async. */
  void requestFlush();
}
