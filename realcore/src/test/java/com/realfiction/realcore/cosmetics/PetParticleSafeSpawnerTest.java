package com.realfiction.realcore.cosmetics;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.cosmetics.pets.PetParticleSafeSpawner;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

/**
 * Verifies the {@link PetParticleSafeSpawner} swallows particle-spawn
 * failures, never propagates exceptions out of {@code tryRun}, and
 * deduplicates log lines so a per-tick failure does not spam the console.
 *
 * <p>Background: Purpur 26.1.2 / Java 25 began requiring {@code Float}
 * data for some particles that previously accepted {@code null}, causing
 * an {@code IllegalArgumentException} every Tiny Dragon body-particle
 * tick on Lobby1. This wrapper is the defensive layer that keeps a single
 * bad particle from taking the pet tick down.
 */
final class PetParticleSafeSpawnerTest {

  private static Logger silentLogger(CapturingHandler captor) {
    Logger logger = Logger.getLogger("PetParticleSafeSpawnerTest." + System.nanoTime());
    logger.setUseParentHandlers(false);
    logger.setLevel(Level.ALL);
    for (Handler existing : logger.getHandlers()) {
      logger.removeHandler(existing);
    }
    logger.addHandler(captor);
    return logger;
  }

  @Test
  void successfulRunReturnsTrueAndDoesNotLog() {
    CapturingHandler captor = new CapturingHandler();
    PetParticleSafeSpawner spawner = new PetParticleSafeSpawner(silentLogger(captor));
    AtomicInteger ran = new AtomicInteger();

    boolean result = spawner.tryRun("tiny-dragon", "DRAGON_BREATH", "test", ran::incrementAndGet);

    assertTrue(result);
    assertEquals(1, ran.get());
    assertEquals(0, captor.warningCount());
    assertEquals(0, spawner.reportedFailureCount());
  }

  @Test
  void failingRunReturnsFalseAndDoesNotThrow() {
    CapturingHandler captor = new CapturingHandler();
    PetParticleSafeSpawner spawner = new PetParticleSafeSpawner(silentLogger(captor));

    boolean result = assertDoesNotThrow(() ->
        spawner.tryRun("tiny-dragon", "PORTAL", "spawnDragonBodyParticles", () -> {
          throw new IllegalArgumentException("missing required data class java.lang.Float");
        })
    );

    assertFalse(result);
    assertEquals(1, captor.warningCount());
    assertEquals(1, spawner.reportedFailureCount());
  }

  @Test
  void repeatedFailuresWithSameKeyOnlyLogOnce() {
    CapturingHandler captor = new CapturingHandler();
    PetParticleSafeSpawner spawner = new PetParticleSafeSpawner(silentLogger(captor));
    Runnable bad = () -> {
      throw new IllegalArgumentException("missing required data class java.lang.Float");
    };

    for (int i = 0; i < 50; i++) {
      assertFalse(spawner.tryRun("tiny-dragon", "PORTAL", "spawnDragonBodyParticles", bad));
    }

    assertEquals(1, captor.warningCount(),
        "Repeated failures with the same key must only log once to avoid console spam");
    assertEquals(1, spawner.reportedFailureCount());
  }

  @Test
  void distinctKeysEachLogOnce() {
    CapturingHandler captor = new CapturingHandler();
    PetParticleSafeSpawner spawner = new PetParticleSafeSpawner(silentLogger(captor));
    Runnable bad = () -> {
      throw new IllegalArgumentException("contract changed");
    };

    spawner.tryRun("tiny-dragon", "PORTAL", "spawnDragonBodyParticles", bad);
    spawner.tryRun("tiny-dragon", "DRAGON_BREATH", "spawnDragonBodyParticles", bad);
    spawner.tryRun("liberty-eagle", "DUST", "spawnAmbientParticle.liberty-eagle", bad);
    // Repeat the first key: must not re-log.
    spawner.tryRun("tiny-dragon", "PORTAL", "spawnDragonBodyParticles", bad);

    assertEquals(3, captor.warningCount());
    assertEquals(3, spawner.reportedFailureCount());
  }

  @Test
  void resetReportedFailuresAllowsKeyToRelog() {
    CapturingHandler captor = new CapturingHandler();
    PetParticleSafeSpawner spawner = new PetParticleSafeSpawner(silentLogger(captor));
    Runnable bad = () -> {
      throw new IllegalArgumentException("contract changed");
    };

    spawner.tryRun("tiny-dragon", "PORTAL", "spawnDragonBodyParticles", bad);
    spawner.tryRun("tiny-dragon", "PORTAL", "spawnDragonBodyParticles", bad);
    assertEquals(1, captor.warningCount());

    spawner.resetReportedFailures();
    assertEquals(0, spawner.reportedFailureCount());

    spawner.tryRun("tiny-dragon", "PORTAL", "spawnDragonBodyParticles", bad);
    assertEquals(2, captor.warningCount(),
        "After reset the same key should log again so operators can observe a recurring issue");
  }

  @Test
  void unrelatedThrowableIsAlsoSwallowed() {
    CapturingHandler captor = new CapturingHandler();
    PetParticleSafeSpawner spawner = new PetParticleSafeSpawner(silentLogger(captor));

    boolean result = assertDoesNotThrow(() ->
        spawner.tryRun("tiny-dragon", "END_ROD", "spawnDragonBodyParticles", () -> {
          throw new NullPointerException("world unloaded");
        })
    );

    assertFalse(result);
    assertEquals(1, captor.warningCount());
  }

  /** Counts WARNING-level records so tests can assert on log volume. */
  private static final class CapturingHandler extends Handler {
    private final AtomicInteger warningCount = new AtomicInteger();

    int warningCount() {
      return warningCount.get();
    }

    @Override
    public void publish(LogRecord record) {
      if (record != null && record.getLevel() != null
          && record.getLevel().intValue() >= Level.WARNING.intValue()) {
        warningCount.incrementAndGet();
      }
    }

    @Override
    public void flush() {
      // no-op
    }

    @Override
    public void close() throws SecurityException {
      // no-op
    }
  }
}
