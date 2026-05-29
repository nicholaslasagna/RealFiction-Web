package com.realfiction.realcore.lobby.seasonal;

import com.realfiction.realcore.lobby.LobbyManager;
import com.realfiction.realcore.luckperms.LuckPermsService;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import java.io.File;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.World;

/** Seasonal lobby orchestration: calendar events, admin preview shows, spawn ambience. */
public final class SeasonalEventsService {
  private final RealCoreScheduler scheduler;
  private final Supplier<LobbyManager> lobbySupplier;
  private final SeasonalEventRegistry registry;
  private final SeasonalSpawnAmbienceService ambience;
  private final SeasonalPreviewController preview;
  /**
   * Big-show layer (distant fireworks, REALFICTION sky banner, themed
   * broadcasts, midnight US National Anthem). Started alongside the
   * ambience service whenever the lobby module is enabled.
   */
  private final SeasonalCelebrationService celebration;
  /**
   * Holds the lobby sky at a holiday-appropriate time of day (noon by default,
   * ramping toward each holiday's sun position as it approaches). Lobby worlds
   * only — gameplay worlds keep their natural cycle.
   */
  private final SeasonalSkyService sky;

  public SeasonalEventsService(
      RealCoreScheduler scheduler,
      Supplier<LobbyManager> lobbySupplier,
      Logger logger
  ) {
    this.scheduler = scheduler;
    this.lobbySupplier = lobbySupplier;
    this.registry = new SeasonalEventRegistry();
    this.ambience = new SeasonalSpawnAmbienceService(scheduler, lobbySupplier, registry);
    this.preview = new SeasonalPreviewController(scheduler, lobbySupplier, ambience, logger);
    this.celebration = new SeasonalCelebrationService(scheduler, lobbySupplier, ambience, logger);
    this.sky = new SeasonalSkyService(scheduler, lobbySupplier, ambience, logger);
  }

  public void start() {
    LobbyManager lobby = lobbySupplier.get();
    if (lobby == null || !lobby.config().enabled()) {
      return;
    }
    ambience.start();
    celebration.start();
    sky.start();
  }

  public void stop() {
    preview.stopPreview();
    celebration.stop();
    ambience.stop();
    sky.stop();
  }

  public void reload() {
    preview.stopPreview();
    ambience.reload();
    celebration.reload();
    sky.reload();
    LobbyManager lobby = lobbySupplier.get();
    if (lobby != null && lobby.config().enabled() && !ambience.running()) {
      ambience.start();
    }
    if (lobby != null && lobby.config().enabled() && !celebration.running()) {
      celebration.start();
    }
    if (lobby != null && lobby.config().enabled() && !sky.running()) {
      sky.start();
    }
  }

  public SeasonalCelebrationService celebration() {
    return celebration;
  }

  /**
   * Forwards US 250 founding-grant config to the celebration service.
   *
   * Called by {@code RealCorePlugin} once both LobbyManager (this
   * service's owner) AND LuckPermsService have finished booting — the
   * plugin instantiates them in that order so they can't be wired at
   * construction time. Safe to call with null arguments; the
   * celebration service falls through to a logged-warning skip on the
   * grant path when LuckPerms isn't available.
   */
  public void configureUs250Founding(LuckPermsService luckPerms, File pluginDataFolder) {
    celebration.configureUs250Founding(luckPerms, pluginDataFolder);
  }

  public SeasonalEventRegistry registry() {
    return registry;
  }

  public SeasonalSpawnAmbienceService ambience() {
    return ambience;
  }

  public SeasonalPreviewController preview() {
    return preview;
  }

  public SeasonalEventDefinition calendarActiveEvent() {
    return registry.activeEvent(LocalDate.now());
  }

  public SeasonalEventDefinition effectiveEvent() {
    return ambience.effectiveEvent(LocalDate.now());
  }

  public SeasonalPreviewController.PreviewStartResult preview(String eventId, org.bukkit.command.CommandSender sender) {
    return preview.preview(eventId, sender);
  }

  /** @deprecated use {@link #preview(String, org.bukkit.command.CommandSender)} */
  @Deprecated
  public boolean startPreview(String eventId) {
    return preview(eventId, Bukkit.getConsoleSender()).success();
  }

  public void stopPreview() {
    preview.stopPreview();
  }

  public SeasonalStatus status() {
    LocalDate today = LocalDate.now();
    LobbyManager lobby = lobbySupplier.get();
    SeasonalEventDefinition calendar = registry.activeEvent(today);
    SeasonalEventDefinition effective = ambience.effectiveEvent(today);
    SeasonalShowOrigin origin = SeasonalShowOrigin.resolve(lobby);
    List<String> configuredWorlds = lobby == null
        ? List.of()
        : new ArrayList<>(lobby.config().worlds());
    List<String> loadedLobbyWorlds = configuredWorlds.stream()
        .filter(name -> Bukkit.getWorld(name) != null)
        .toList();
    List<String> availableWorlds = lobby == null
        ? List.of()
        : Bukkit.getWorlds().stream().map(World::getName).toList();

    return new SeasonalStatus(
        lobby != null && lobby.config().enabled(),
        calendar == null ? "" : calendar.id(),
        effective == null ? "" : effective.id(),
        preview.previewRunning(),
        preview.previewId(),
        preview.showLockRunning(),
        configuredWorlds,
        loadedLobbyWorlds,
        availableWorlds,
        origin.summary(),
        preview.lastPreviewStart(),
        preview.lastPreviewFailure(),
        ambience.previewEventId(),
        ambience.running() && ambience.shouldRunAmbience(today),
        ambience.effectiveTheme(today).name(),
        ambience.lobbyPlayerCount(),
        ambience.lastFailure(),
        registry.definitionCount()
    );
  }

  public record SeasonalStatus(
      boolean seasonalServiceLoaded,
      String calendarActiveEventId,
      String effectiveEventId,
      boolean previewRunning,
      String previewId,
      boolean showLockRunning,
      List<String> configuredLobbyWorlds,
      List<String> loadedLobbyWorlds,
      List<String> availableWorlds,
      String resolvedPreviewOrigin,
      String lastPreviewStart,
      String lastPreviewFailure,
      String ambiencePreviewEventId,
      boolean spawnAmbienceRunning,
      String ambienceTheme,
      int lobbyPlayerCount,
      String lastAmbienceFailure,
      int registeredEvents
  ) {
  }
}
