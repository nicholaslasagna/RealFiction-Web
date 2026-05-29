package com.realfiction.realcore.lobby.seasonal;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Defensive wrapper for seasonal visual effects (firework spawns, particle
 * bursts, sky-banner pixels).
 *
 * <p>The audit found no current crashing effect — every particle supplies the
 * data class it needs (DUST → DustOptions, FALLING_DUST → BlockData, the rest
 * are no-data). But Paper/Purpur occasionally tighten a particle's data
 * contract between releases (the pet system hit exactly this when PORTAL began
 * requiring a Float on Purpur 26.1.2). If that ever happens here, this guard
 * keeps a single bad effect from throwing out of a repeating scheduler tick —
 * it swallows the failure and logs it once per label instead of every tick.
 */
public final class SeasonalEffectGuard {
  private static final Logger LOGGER = Logger.getLogger("RealCore-Seasonal");
  private static final Set<String> REPORTED = ConcurrentHashMap.newKeySet();

  private SeasonalEffectGuard() {
  }

  /**
   * Runs a visual effect, swallowing any throwable so it can't break the
   * scheduler tick. Logs the first failure for a given label, then suppresses
   * repeats to avoid console spam.
   */
  public static void run(String label, Runnable effect) {
    try {
      effect.run();
    } catch (Throwable error) {
      if (REPORTED.add(label)) {
        LOGGER.log(Level.WARNING,
            "Seasonal effect '" + label + "' failed and was disabled for this session "
                + "(repeats suppressed)", error);
      }
    }
  }

  /** Test/diagnostic hook. */
  static int reportedCount() {
    return REPORTED.size();
  }

  /** Test/diagnostic hook. */
  static void reset() {
    REPORTED.clear();
  }
}
