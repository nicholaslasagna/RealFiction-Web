package com.realfiction.realcore.rewards;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Persistent ledger of reward IDs whose local effects (console commands,
 * LuckPerms grants) have already executed on THIS server.
 *
 * <p>It survives restarts and reclaim cycles so that a reward which was delivered
 * but whose acknowledgement failed is never executed a second time. On the next
 * poll such a reward is only re-acked. This is the safety net that prevents
 * duplicate money/perks while {@code /api/plugin/rewards/ack} is failing.
 *
 * <p>Format is one {@code rewardId,epochMillis} line per delivery (append-only,
 * crash-safe). Entries older than the retention window are pruned on load.
 */
public final class RewardLedger {
  private static final Duration RETENTION = Duration.ofDays(14);

  private final Path file;
  private final Logger logger;
  private final Map<String, Long> delivered = new ConcurrentHashMap<>();

  public RewardLedger(Path file, Logger logger) {
    this.file = file;
    this.logger = logger;
  }

  public synchronized void load() {
    delivered.clear();
    if (file == null || !Files.exists(file)) {
      return;
    }
    long cutoff = System.currentTimeMillis() - RETENTION.toMillis();
    try {
      for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
        String trimmed = line.trim();
        if (trimmed.isEmpty()) {
          continue;
        }
        int comma = trimmed.lastIndexOf(',');
        String id = comma < 0 ? trimmed : trimmed.substring(0, comma);
        long ts;
        try {
          ts = comma < 0 ? System.currentTimeMillis() : Long.parseLong(trimmed.substring(comma + 1).trim());
        } catch (NumberFormatException ex) {
          ts = System.currentTimeMillis();
        }
        if (!id.isBlank() && ts >= cutoff) {
          delivered.put(id, ts);
        }
      }
    } catch (IOException ex) {
      logger.log(Level.WARNING, "Could not read reward ledger; continuing with an empty ledger.", ex);
    }
    rewrite();
  }

  public boolean wasDelivered(String rewardId) {
    return rewardId != null && delivered.containsKey(rewardId);
  }

  /** Records a reward as locally delivered and persists it immediately. */
  public void markDelivered(String rewardId) {
    if (rewardId == null || rewardId.isBlank()) {
      return;
    }
    if (delivered.putIfAbsent(rewardId, System.currentTimeMillis()) == null) {
      append(rewardId);
    }
  }

  public int size() {
    return delivered.size();
  }

  private void append(String rewardId) {
    if (file == null) {
      return;
    }
    try {
      if (file.getParent() != null) {
        Files.createDirectories(file.getParent());
      }
      Files.writeString(
          file,
          rewardId + "," + System.currentTimeMillis() + System.lineSeparator(),
          StandardCharsets.UTF_8,
          StandardOpenOption.CREATE,
          StandardOpenOption.APPEND);
    } catch (IOException ex) {
      logger.log(Level.WARNING, "Could not persist reward ledger entry " + rewardId, ex);
    }
  }

  private synchronized void rewrite() {
    if (file == null) {
      return;
    }
    try {
      if (file.getParent() != null) {
        Files.createDirectories(file.getParent());
      }
      List<String> lines = new ArrayList<>(delivered.size());
      delivered.forEach((id, ts) -> lines.add(id + "," + ts));
      Files.write(
          file,
          lines,
          StandardCharsets.UTF_8,
          StandardOpenOption.CREATE,
          StandardOpenOption.TRUNCATE_EXISTING);
    } catch (IOException ex) {
      logger.log(Level.WARNING, "Could not rewrite reward ledger.", ex);
    }
  }
}
