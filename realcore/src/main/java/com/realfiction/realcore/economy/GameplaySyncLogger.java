package com.realfiction.realcore.economy;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Structured gameplay sync logging with bounded repeat suppression.
 */
public final class GameplaySyncLogger {
  private static final long SUPPRESS_WINDOW_MS = 60_000;
  private static final int MAX_SUPPRESSED_PER_KEY = 5;

  private final Logger logger;
  private final Map<String, SuppressionState> suppressed = new ConcurrentHashMap<>();

  public GameplaySyncLogger(Logger logger) {
    this.logger = logger == null ? Logger.getLogger("RealCore") : logger;
  }

  public void error(String message) {
    logger.warning("[GameplaySync:ERROR] " + message);
  }

  public void errorOnce(String key, String message) {
    if (shouldEmit(key)) {
      error(message);
    }
  }

  public void warn(String message) {
    logger.warning("[GameplaySync:WARN] " + message);
  }

  public void warnOnce(String key, String message) {
    if (shouldEmit(key)) {
      warn(message);
    }
  }

  public void batch(String message) {
    if (logger.isLoggable(Level.FINE)) {
      logger.fine("[GameplaySync:BATCH] " + message);
    } else {
      logger.info("[GameplaySync:BATCH] " + message);
    }
  }

  public void queue(String message) {
    if (logger.isLoggable(Level.FINE)) {
      logger.fine("[GameplaySync:QUEUE] " + message);
    }
  }

  public void summary(String message) {
    logger.info("[GameplaySync:BATCH] summary " + message);
  }

  private boolean shouldEmit(String key) {
    long now = System.currentTimeMillis();
    SuppressionState state = suppressed.computeIfAbsent(key, ignored -> new SuppressionState());
    synchronized (state) {
      if (now - state.windowStartMs > SUPPRESS_WINDOW_MS) {
        state.windowStartMs = now;
        state.count = 0;
      }
      state.count++;
      if (state.count <= MAX_SUPPRESSED_PER_KEY) {
        return true;
      }
      if (state.count == MAX_SUPPRESSED_PER_KEY + 1) {
        logger.warning("[GameplaySync:WARN] suppressed further '" + key + "' warnings for 60s");
      }
      return false;
    }
  }

  private static final class SuppressionState {
    private long windowStartMs = System.currentTimeMillis();
    private int count;
  }
}
