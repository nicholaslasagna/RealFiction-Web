package com.realfiction.realcore.cosmetics.pets;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Defensive wrapper around pet particle spawn calls.
 *
 * <p>Purpur/Paper occasionally tightens the typed-data contract on
 * {@link org.bukkit.Particle} between minor releases (e.g. Purpur 26.1.2
 * began requiring {@code Float} data for some particles that previously
 * accepted {@code null}). When that happens, {@code World#spawnParticle}
 * throws an {@link IllegalArgumentException} every tick, which both
 * floods the console and propagates out of our scheduler tick. The
 * exception was observed on Lobby1 from the Tiny Dragon pet body
 * particles (see issue tracker / production stack trace).
 *
 * <p>This helper swallows particle-spawn failures so a single bad
 * particle never takes the pet tick down, and logs each unique
 * (pet, particle, call-site) failure exactly once so we have signal
 * without log spam. The wrapped lambda is expected to be a single
 * particle spawn — keep the work small so a per-tick catch is cheap.
 *
 * <p>Thread-safe; the dedup set uses a concurrent hash set. The pet
 * tick path is dispatched via {@code RealCoreScheduler.runForPlayer},
 * which on Folia is a per-region thread, so concurrent {@link #tryRun}
 * calls from different player regions are expected.
 */
public final class PetParticleSafeSpawner {
  private final Logger logger;
  private final Set<String> reportedFailures = ConcurrentHashMap.newKeySet();

  public PetParticleSafeSpawner(Logger logger) {
    this.logger = logger;
  }

  /**
   * Runs the provided particle-spawn lambda, catching any throwable
   * the server may surface (typed-data mismatch, world unloaded, etc.).
   *
   * @param petId        cosmetic pet definition id (e.g. "tiny-dragon")
   * @param particleName name of the Bukkit particle being spawned, for log signal
   * @param callSite     short identifier of the caller (e.g. "spawnDragonBodyParticles")
   * @param particleCall the actual {@code World#spawnParticle(...)} invocation
   * @return {@code true} if the call completed without throwing, {@code false} if it failed
   */
  public boolean tryRun(String petId, String particleName, String callSite, Runnable particleCall) {
    try {
      particleCall.run();
      return true;
    } catch (Throwable error) {
      String key = petId + "|" + particleName + "|" + callSite;
      if (reportedFailures.add(key)) {
        logger.log(
            Level.WARNING,
            "Pet particle disabled after first failure: pet=" + petId
                + " particle=" + particleName + " callSite=" + callSite
                + " (subsequent failures for this key will be suppressed)",
            error
        );
      }
      return false;
    }
  }

  /** Test/diagnostic hook. Returns the number of distinct failure keys logged so far. */
  public int reportedFailureCount() {
    return reportedFailures.size();
  }

  /** Test/diagnostic hook. Clears the dedup set so a key can re-log. */
  public void resetReportedFailures() {
    reportedFailures.clear();
  }
}
