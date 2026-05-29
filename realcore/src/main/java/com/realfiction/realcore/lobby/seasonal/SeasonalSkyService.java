package com.realfiction.realcore.lobby.seasonal;

import com.realfiction.realcore.lobby.LobbyConfig;
import com.realfiction.realcore.lobby.LobbyManager;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.time.LocalDate;
import java.util.function.Supplier;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.GameRule;
import org.bukkit.World;

/**
 * Holds the lobby sky at a holiday-appropriate time of day.
 *
 * <p>Drives {@link SeasonalSkyClock}: noon by default, sliding toward each
 * holiday's fitting sun position as the date approaches and back to noon after.
 * Only ever touches the configured <b>lobby</b> worlds — survival, factions,
 * and every other world keep their natural day/night cycle untouched.
 *
 * <p>It freezes the cycle on lobby worlds ({@code doDaylightCycle = false}) and
 * re-asserts the computed time periodically, so the chosen sun position holds
 * steady instead of drifting. Folia-safe: world time/gamerule changes run on
 * the global region scheduler.
 */
public final class SeasonalSkyService {
  // Re-assert every 10s — time is frozen between updates, this just keeps it
  // pinned and lets the day-by-day ramp move it along.
  private static final long INTERVAL_TICKS = 200L;

  private final RealCoreScheduler scheduler;
  private final Supplier<LobbyManager> lobbySupplier;
  private final SeasonalSpawnAmbienceService ambience;
  private final Logger logger;

  private ScheduledTaskHandle task;
  private volatile boolean running;

  public SeasonalSkyService(
      RealCoreScheduler scheduler,
      Supplier<LobbyManager> lobbySupplier,
      SeasonalSpawnAmbienceService ambience,
      Logger logger
  ) {
    this.scheduler = scheduler;
    this.lobbySupplier = lobbySupplier;
    this.ambience = ambience;
    this.logger = logger;
  }

  public void start() {
    stop();
    LobbyManager lobby = lobbySupplier.get();
    if (lobby == null || !lobby.config().enabled()) {
      return;
    }
    task = scheduler.runGlobalRepeating(this::applySky, 0L, INTERVAL_TICKS);
    running = true;
  }

  public void stop() {
    if (task != null) {
      task.cancel();
      task = null;
    }
    running = false;
  }

  public void reload() {
    stop();
    LobbyManager lobby = lobbySupplier.get();
    if (lobby != null && lobby.config().enabled()) {
      start();
    }
  }

  public boolean running() {
    return running;
  }

  private void applySky() {
    SeasonalEffectGuard.run("sky-clock", () -> {
      LobbyManager lobby = lobbySupplier.get();
      if (lobby == null || !lobby.config().enabled()) {
        return;
      }
      LobbyConfig config = lobby.config();
      long time = resolveTargetTime();

      for (String worldName : config.worlds()) {
        World world = Bukkit.getWorld(worldName);
        if (world == null) {
          continue;
        }
        // Freeze the cycle (lobby worlds only) so the chosen sun position
        // holds; only flip it when needed so we don't thrash the gamerule.
        if (Boolean.TRUE.equals(world.getGameRuleValue(GameRule.DO_DAYLIGHT_CYCLE))) {
          world.setGameRule(GameRule.DO_DAYLIGHT_CYCLE, false);
        }
        world.setTime(time);
      }
    });
  }

  /**
   * Today's lobby time. During an admin preview, shows the previewed holiday's
   * full sky immediately (the real date is usually nowhere near it); otherwise
   * uses the date-ramped time for whatever event is currently active.
   */
  private long resolveTargetTime() {
    LocalDate today = LocalDate.now();
    SeasonalEventDefinition event = ambience.effectiveEvent(today);
    if (event == null) {
      return SeasonalSkyClock.NOON;
    }
    String preview = ambience.previewEventId();
    if (preview != null && !preview.isBlank()) {
      return SeasonalSkyClock.previewTime(event.ambienceTheme());
    }
    return SeasonalSkyClock.targetTime(event.ambienceTheme(), today);
  }
}
