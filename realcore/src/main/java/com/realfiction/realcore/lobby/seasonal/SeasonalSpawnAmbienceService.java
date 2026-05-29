package com.realfiction.realcore.lobby.seasonal;

import com.realfiction.realcore.lobby.LobbyConfig;
import com.realfiction.realcore.lobby.LobbyManager;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/**
 * Lobby spawn-area seasonal ambience: particles and subtle sounds around the lobby spawn.
 */
public final class SeasonalSpawnAmbienceService {
  private static final long MIN_PERIOD_TICKS = 40L;
  private static final long MAX_PERIOD_TICKS = 100L;

  private final RealCoreScheduler scheduler;
  private final Supplier<LobbyManager> lobbySupplier;
  private final SeasonalEventRegistry registry;

  private volatile String previewEventId = "";
  private ScheduledTaskHandle tickTask;
  private final AtomicInteger burstCounter = new AtomicInteger();
  private volatile boolean running;
  private volatile SeasonalShowOrigin cachedOrigin = SeasonalShowOrigin.resolve(null);
  private volatile String lastFailure = "";

  public SeasonalSpawnAmbienceService(
      RealCoreScheduler scheduler,
      Supplier<LobbyManager> lobbySupplier,
      SeasonalEventRegistry registry
  ) {
    this.scheduler = scheduler;
    this.lobbySupplier = lobbySupplier;
    this.registry = registry;
  }

  public void start() {
    stop();
    LobbyManager lobby = lobbySupplier.get();
    if (lobby == null || !lobby.config().enabled()) {
      return;
    }
    refreshOrigin();
    long period = (MIN_PERIOD_TICKS + MAX_PERIOD_TICKS) / 2;
    tickTask = scheduler.runGlobalRepeating(this::tick, period, period);
    running = true;
  }

  public void stop() {
    if (tickTask != null) {
      tickTask.cancel();
      tickTask = null;
    }
    running = false;
    previewEventId = "";
  }

  public void reload() {
    refreshOrigin();
  }

  public boolean running() {
    return running && tickTask != null;
  }

  public void setPreviewEventId(String eventId) {
    previewEventId = eventId == null ? "" : eventId.trim().toLowerCase();
  }

  public void clearPreview() {
    previewEventId = "";
  }

  public String previewEventId() {
    return previewEventId;
  }

  public SeasonalShowOrigin origin() {
    return cachedOrigin;
  }

  public String lastFailure() {
    return lastFailure;
  }

  public SeasonalEventDefinition effectiveEvent(LocalDate date) {
    if (date == null) {
      date = LocalDate.now();
    }
    if (previewEventId != null && !previewEventId.isBlank()) {
      return registry.byId(previewEventId).orElse(null);
    }
    return registry.activeEvent(date);
  }

  public SeasonalAmbienceTheme effectiveTheme(LocalDate date) {
    SeasonalEventDefinition event = effectiveEvent(date);
    return event == null ? SeasonalAmbienceTheme.NONE : event.ambienceTheme();
  }

  public int lobbyPlayerCount() {
    LobbyManager lobby = lobbySupplier.get();
    if (lobby == null) {
      return 0;
    }
    LobbyConfig config = lobby.config();
    int count = 0;
    for (Player player : Bukkit.getOnlinePlayers()) {
      if (player.getWorld() != null && config.isLobbyWorld(player.getWorld().getName())) {
        count++;
      }
    }
    return count;
  }

  public boolean shouldRunAmbience(LocalDate date) {
    if (!running) {
      return false;
    }
    if (effectiveEvent(date) == null) {
      return false;
    }
    boolean previewActive = previewEventId != null && !previewEventId.isBlank();
    if (!previewActive && lobbyPlayerCount() <= 0) {
      return false;
    }
    if (!cachedOrigin.valid()) {
      return false;
    }
    return true;
  }

  private void tick() {
    LobbyManager lobby = lobbySupplier.get();
    if (lobby == null || !lobby.config().enabled()) {
      return;
    }

    refreshOrigin();
    LocalDate today = LocalDate.now();
    SeasonalEventDefinition event = effectiveEvent(today);
    if (event == null) {
      return;
    }

    boolean previewActive = previewEventId != null && !previewEventId.isBlank();
    int lobbyPlayers = lobbyPlayerCount();
    if (!previewActive && lobbyPlayers <= 0) {
      return;
    }

    if (!cachedOrigin.valid()) {
      lastFailure = "no ambience origin";
      return;
    }
    lastFailure = "";

    Location origin = cachedOrigin.location().clone();
    int budget = SeasonalAmbienceBudget.particleBudget(lobbyPlayers);
    if (budget <= 0) {
      return;
    }

    int tickSeed = burstCounter.incrementAndGet();
    boolean playSound = SeasonalAmbienceBudget.shouldPlaySound(lobbyPlayers)
        && tickSeed % 5 == 0;

    scheduler.runGlobal(() -> SeasonalAmbienceEffects.playBurst(
        event.ambienceTheme(),
        origin,
        budget,
        false,
        tickSeed
    ));

    if (playSound) {
      List<Player> audience = audienceNear(origin, lobby);
      for (Player player : audience) {
        scheduler.runForPlayer(player, () -> SeasonalAmbienceEffects.playSoundForPlayer(
            player,
            event.ambienceTheme(),
            origin
        ));
      }
    }
  }

  private List<Player> audienceNear(Location origin, LobbyManager lobby) {
    List<Player> audience = new ArrayList<>();
    LobbyConfig config = lobby.config();
    double radiusSq = SeasonalAmbienceBudget.SOUND_RADIUS * SeasonalAmbienceBudget.SOUND_RADIUS;
    for (Player player : Bukkit.getOnlinePlayers()) {
      if (player.getWorld() == null || !config.isLobbyWorld(player.getWorld().getName())) {
        continue;
      }
      if (!player.getWorld().equals(origin.getWorld())) {
        continue;
      }
      if (player.getLocation().distanceSquared(origin) <= radiusSq) {
        audience.add(player);
      }
    }
    return audience;
  }

  private void refreshOrigin() {
    cachedOrigin = SeasonalShowOrigin.resolve(lobbySupplier.get());
  }
}
