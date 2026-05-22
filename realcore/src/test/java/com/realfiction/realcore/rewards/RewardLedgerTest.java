package com.realfiction.realcore.rewards;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class RewardLedgerTest {
  private static final Logger LOGGER = Logger.getLogger(RewardLedgerTest.class.getName());

  @Test
  void persistsDeliveredRewardsAcrossReload(@TempDir Path dir) {
    Path file = dir.resolve("delivered-rewards.log");

    RewardLedger ledger = new RewardLedger(file, LOGGER);
    ledger.load();
    assertFalse(ledger.wasDelivered("reward-1"));

    ledger.markDelivered("reward-1");
    assertTrue(ledger.wasDelivered("reward-1"));

    // A fresh instance (simulating a plugin restart) must still see the delivery
    // so a failed ack never causes a second execution.
    RewardLedger reloaded = new RewardLedger(file, LOGGER);
    reloaded.load();
    assertTrue(reloaded.wasDelivered("reward-1"));
    assertFalse(reloaded.wasDelivered("reward-2"));
  }

  @Test
  void markingSameRewardTwiceWritesOneEntry(@TempDir Path dir) throws IOException {
    Path file = dir.resolve("delivered.log");

    RewardLedger ledger = new RewardLedger(file, LOGGER);
    ledger.load();
    ledger.markDelivered("dup");
    ledger.markDelivered("dup");

    assertEquals(1, ledger.size());
    assertEquals(1, Files.readAllLines(file).stream().filter(line -> !line.isBlank()).count());
  }
}
