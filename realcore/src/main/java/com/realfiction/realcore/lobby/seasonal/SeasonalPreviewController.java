package com.realfiction.realcore.lobby.seasonal;

import com.realfiction.realcore.lobby.LobbyConfig;
import com.realfiction.realcore.lobby.LobbyManager;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.SoundCategory;
import org.bukkit.World;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/** Admin seasonal preview shows (bypass calendar windows). */
public final class SeasonalPreviewController {
  static final int PREVIEW_DURATION_SECONDS = 45;
  static final long COUNTDOWN_TICKS = 20L;
  private static final long PREVIEW_END_TICKS = PREVIEW_DURATION_SECONDS * 20L;

  private final RealCoreScheduler scheduler;
  private final Supplier<LobbyManager> lobbySupplier;
  private final SeasonalSpawnAmbienceService ambience;
  private final FireworkShowService fireworkShowService;
  private final Logger logger;

  private final AtomicBoolean previewRunning = new AtomicBoolean(false);
  private final AtomicBoolean showLockRunning = new AtomicBoolean(false);
  private final List<ScheduledTaskHandle> previewTasks = new CopyOnWriteArrayList<>();

  private volatile String previewId = "";
  private volatile String lastPreviewStart = "";
  private volatile String lastPreviewFailure = "";

  public SeasonalPreviewController(
      RealCoreScheduler scheduler,
      Supplier<LobbyManager> lobbySupplier,
      SeasonalSpawnAmbienceService ambience,
      Logger logger
  ) {
    this.scheduler = scheduler;
    this.lobbySupplier = lobbySupplier;
    this.ambience = ambience;
    this.fireworkShowService = new FireworkShowService(scheduler);
    this.logger = logger;
  }

  public PreviewStartResult preview(String rawEventId, CommandSender sender) {
    LobbyManager lobby = lobbySupplier.get();
    if (lobby == null || !lobby.config().enabled()) {
      lastPreviewFailure = "lobby module is not loaded or disabled";
      return PreviewStartResult.failure(lastPreviewFailure);
    }
    if (!previewRunning.compareAndSet(false, true)) {
      lastPreviewFailure = "a seasonal preview is already running (use /rf seasonal stoppreview)";
      return PreviewStartResult.failure(lastPreviewFailure);
    }

    try {
      SeasonalPreviewCatalog.PreviewSpec spec = SeasonalPreviewCatalog.resolve(rawEventId)
          .orElse(null);
      if (spec == null) {
        previewRunning.set(false);
        lastPreviewFailure = "unknown event id. Valid ids: " + SeasonalPreviewCatalog.validIdsMessage();
        return PreviewStartResult.failure(lastPreviewFailure);
      }

      if (!hasLoadedLobbyWorld(lobby)) {
        previewRunning.set(false);
        lastPreviewFailure = describeMissingLobbyWorlds(lobby);
        logger.warning("Seasonal preview blocked: " + lastPreviewFailure);
        return PreviewStartResult.failure(lastPreviewFailure);
      }

      SeasonalShowOrigin origin = SeasonalShowOrigin.resolve(lobby);
      if (!origin.valid()) {
        previewRunning.set(false);
        lastPreviewFailure = "no preview origin (" + origin.source() + "); " + describeWorlds(lobby);
        logger.warning("Seasonal preview blocked: " + lastPreviewFailure);
        return PreviewStartResult.failure(lastPreviewFailure);
      }

      cancelPreviewTasks();
      previewId = spec.canonicalId();
      showLockRunning.set(true);
      lastPreviewFailure = "";
      lastPreviewStart = Instant.now().toString();
      ambience.setPreviewEventId(spec.ambienceEventId());
      if (!ambience.running()) {
        ambience.start();
      }

      Location anchor = origin.location().clone();
      logger.info("Starting seasonal preview " + spec.canonicalId() + " at " + origin.summary()
          + " by " + sender.getName());

      schedulePreviewSequence(spec, anchor);

      String message = "Starting seasonal preview: " + spec.canonicalId() + " at "
          + formatOrigin(anchor) + ". Duration ~" + PREVIEW_DURATION_SECONDS + "s.";
      if (spec.midnightPreview()) {
        message += " (preview-only midnight; no rewards or milestone persistence)";
      }
      return PreviewStartResult.success(message);
    } catch (RuntimeException error) {
      previewRunning.set(false);
      showLockRunning.set(false);
      previewId = "";
      cancelPreviewTasks();
      lastPreviewFailure = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
      logger.log(Level.WARNING, "Seasonal preview failed to start", error);
      return PreviewStartResult.failure("preview failed: " + lastPreviewFailure);
    }
  }

  public void stopPreview() {
    cancelPreviewTasks();
    previewRunning.set(false);
    showLockRunning.set(false);
    previewId = "";
    ambience.clearPreview();
    logger.info("Seasonal preview stopped and tasks cleared.");
  }

  private void cancelPreviewTasks() {
    for (ScheduledTaskHandle handle : previewTasks) {
      if (handle != null) {
        handle.cancel();
      }
    }
    previewTasks.clear();
  }

  private void finishPreview(String id) {
    logger.info("Seasonal preview finished: " + id);
    stopPreview();
  }

  private void schedulePreviewSequence(SeasonalPreviewCatalog.PreviewSpec spec, Location anchor) {
    scheduleDelayed(() -> runCountdown(anchor, 3), 0L);
    scheduleDelayed(() -> runCountdown(anchor, 2), COUNTDOWN_TICKS);
    scheduleDelayed(() -> runCountdown(anchor, 1), COUNTDOWN_TICKS * 2);
    scheduleDelayed(() -> runCountdown(anchor, 0), COUNTDOWN_TICKS * 3);
    scheduleDelayed(() -> launchMainBurst(spec, anchor), COUNTDOWN_TICKS * 4);
    scheduleDelayed(() -> renderThemedVisuals(spec, anchor), COUNTDOWN_TICKS * 6);
    // Play the holiday's real song (The Star-Spangled Banner for patriotic
    // events, Jingle Bells for Christmas) so admins hear exactly what fires at
    // midnight — instead of the old placeholder scale.
    List<SeasonalSongbook.Note> song = SeasonalSongbook.songFor(spec.theme());
    if (song != null) {
      scheduleDelayed(() -> playSongForAudience(anchor, song), COUNTDOWN_TICKS * 8);
    }
    if (spec.midnightPreview()) {
      scheduleDelayed(() -> runMidnightVisuals(anchor), COUNTDOWN_TICKS * 10);
    }
    scheduleDelayed(() -> finishPreview(spec.canonicalId()), PREVIEW_END_TICKS);
  }

  private void runCountdown(Location anchor, int number) {
    String title = number <= 0 ? ChatColor.GOLD + "Preview!" : ChatColor.YELLOW + Integer.toString(number);
    String subtitle = ChatColor.GRAY + "Seasonal preview";
    for (Player player : audience(anchor)) {
      scheduler.runForPlayer(player, () -> {
        if (!player.isOnline()) {
          return;
        }
        player.sendTitle(title, subtitle, 5, 25, 10);
        player.sendActionBar(ChatColor.AQUA + "Seasonal preview starting...");
        FireworkShowService.playCountdownSound(player, Math.max(1, number));
      });
    }
    if (number > 0) {
      burstCountdownParticles(anchor);
    }
  }

  private void launchMainBurst(SeasonalPreviewCatalog.PreviewSpec spec, Location anchor) {
    SeasonalEffectPalette palette = SeasonalEffectPalette.generic(spec.theme());
    fireworkShowService.launchRing(anchor, 12, palette);
    scheduler.runGlobal(() -> {
      World world = anchor.getWorld();
      if (world == null) {
        logger.warning("Seasonal preview skipped particle burst: world unloaded");
        return;
      }
      for (int i = 0; i < 24; i++) {
        double angle = i * 0.55D;
        Location point = anchor.clone().add(Math.cos(angle) * 6, 1.5D + (i % 3) * 0.4D, Math.sin(angle) * 6);
        SeasonalAmbienceEffects.playBurst(spec.theme(), point, 8, false, i);
      }
    });
  }

  private void renderThemedVisuals(SeasonalPreviewCatalog.PreviewSpec spec, Location anchor) {
    SeasonalEffectPalette palette = SeasonalEffectPalette.generic(spec.theme());
    // Every preview paints a REALFICTION sky banner so the brand stays
    // anchored regardless of theme; per-theme bottom line / particle FX
    // layer on top of the brand line.
    switch (spec.theme()) {
      case US250_INDEPENDENCE_DAY, INDEPENDENCE_DAY, VETERANS_DAY, MEMORIAL_DAY -> {
        fireworkShowService.launchRing(anchor, 8, palette);
        SeasonalParticleTextRenderer.renderDistantBanner(
            scheduler,
            anchor,
            "REALFICTION",
            "250 YEARS",
            Color.RED,
            Color.fromRGB(255, 215, 0)
        );
      }
      case CHRISTMAS -> {
        spawnParticleRibbon(anchor, Particle.SNOWFLAKE, 40);
        spawnColoredDustRibbon(anchor, Color.fromRGB(220, 20, 60), 12);
        spawnColoredDustRibbon(anchor, Color.fromRGB(0, 128, 0), 12);
        spawnColoredDustRibbon(anchor, Color.fromRGB(255, 215, 0), 12);
        SeasonalParticleTextRenderer.renderDistantBanner(
            scheduler,
            anchor,
            "REALFICTION",
            "MERRY",
            Color.fromRGB(40, 175, 60),
            Color.fromRGB(220, 32, 48)
        );
      }
      case HALLOWEEN -> {
        spawnParticleRibbon(anchor, Particle.SMOKE, 30);
        spawnParticleRibbon(anchor, Particle.SOUL_FIRE_FLAME, 20);
        fireworkShowService.launchRing(anchor, 6, palette);
        // Halloween theme: no two-line banner — the bitmap font doesn't have
        // a W glyph for "HALLOWEEN", so we paint REALFICTION solo (distant).
        SeasonalParticleTextRenderer.renderDistantBanner(
            scheduler, anchor, "REALFICTION", null, Color.fromRGB(255, 140, 0), Color.fromRGB(255, 140, 0));
      }
      case NEW_YEARS -> {
        fireworkShowService.launchRing(anchor, 10, palette);
        SeasonalParticleTextRenderer.renderDistantBanner(
            scheduler,
            anchor,
            "REALFICTION",
            "2026",
            Color.fromRGB(255, 215, 0),
            Color.WHITE
        );
      }
      default -> {
        fireworkShowService.launchRing(anchor, 6, palette);
        SeasonalParticleTextRenderer.renderDistantBanner(
            scheduler, anchor, "REALFICTION", null, Color.fromRGB(255, 215, 0), Color.fromRGB(255, 215, 0));
      }
    }
  }

  /**
   * Plays a song (anthem / Jingle Bells) for everyone in the preview audience.
   * Each note is dispatched through {@link #scheduleDelayed} so it is tracked
   * as a preview task and gets cancelled by {@code /rf seasonal stoppreview}.
   */
  private void playSongForAudience(Location anchor, List<SeasonalSongbook.Note> song) {
    for (SeasonalSongbook.Note note : song) {
      float pitch = note.pitch();
      scheduleDelayed(() -> {
        for (Player player : audience(anchor)) {
          scheduler.runForPlayer(player, () -> {
            if (!player.isOnline()) {
              return;
            }
            player.playSound(player.getLocation(), Sound.BLOCK_NOTE_BLOCK_BELL,
                SoundCategory.AMBIENT, 0.8f, pitch);
          });
        }
      }, note.delayTicks());
    }
  }

  private void runMidnightVisuals(Location anchor) {
    SeasonalParticleTextRenderer.renderBanner(
        scheduler,
        anchor,
        "US 250",
        "MIDNIGHT",
        Color.WHITE,
        Color.fromRGB(255, 215, 0)
    );
    fireworkShowService.launchRing(anchor, 10, SeasonalEffectPalette.patriotic());
  }

  private void burstCountdownParticles(Location anchor) {
    // Guarded: a particle data-contract change must never crash a preview.
    scheduler.runGlobal(() -> SeasonalEffectGuard.run("preview-countdown", () -> {
      if (anchor.getWorld() == null) {
        return;
      }
      anchor.getWorld().spawnParticle(Particle.FIREWORK, anchor.clone().add(0, 2, 0), 6, 1.5, 0.5, 1.5, 0.02);
    }));
  }

  private void spawnParticleRibbon(Location anchor, Particle particle, int count) {
    scheduler.runGlobal(() -> SeasonalEffectGuard.run("preview-ribbon-" + particle.name(), () -> {
      if (anchor.getWorld() == null) {
        return;
      }
      for (int i = 0; i < count; i++) {
        double angle = i * 0.35D;
        Location point = anchor.clone().add(Math.cos(angle) * 8, 2 + Math.sin(i * 0.2) * 2, Math.sin(angle) * 8);
        anchor.getWorld().spawnParticle(particle, point, 2, 0.2, 0.2, 0.2, 0.01);
      }
    }));
  }

  private void spawnColoredDustRibbon(Location anchor, Color color, int count) {
    scheduler.runGlobal(() -> SeasonalEffectGuard.run("preview-dust-ribbon", () -> {
      World world = anchor.getWorld();
      if (world == null) {
        return;
      }
      Particle.DustOptions dust = new Particle.DustOptions(color, 1.2f);
      for (int i = 0; i < count; i++) {
        double angle = i * 0.5D;
        Location point = anchor.clone().add(Math.cos(angle) * 7, 3 + (i % 4) * 0.5D, Math.sin(angle) * 7);
        world.spawnParticle(Particle.DUST, point, 3, 0.15, 0.15, 0.15, 0, dust, true);
      }
    }));
  }

  private List<Player> audience(Location anchor) {
    List<Player> players = new ArrayList<>();
    LobbyManager lobby = lobbySupplier.get();
    if (lobby == null || anchor.getWorld() == null) {
      return players;
    }
    LobbyConfig config = lobby.config();
    World originWorld = anchor.getWorld();
    for (Player player : Bukkit.getOnlinePlayers()) {
      if (player.getWorld() != null && player.getWorld().equals(originWorld)) {
        players.add(player);
        continue;
      }
      if (player.getWorld() != null && config.isLobbyWorld(player.getWorld().getName())) {
        players.add(player);
      }
    }
    return players;
  }

  private void scheduleDelayed(Runnable task, long delayTicks) {
    ScheduledTaskHandle handle = scheduler.runGlobalLater(task, delayTicks);
    if (handle == null) {
      logger.warning("Seasonal preview could not schedule delayed task at " + delayTicks + " ticks; running now");
      scheduler.runGlobal(task);
      return;
    }
    previewTasks.add(handle);
  }

  private static boolean hasLoadedLobbyWorld(LobbyManager lobby) {
    for (String worldName : lobby.config().worlds()) {
      if (Bukkit.getWorld(worldName) != null) {
        return true;
      }
    }
    World spawnWorld = Bukkit.getWorld(lobby.config().spawn().world());
    return spawnWorld != null;
  }

  private static String formatOrigin(Location location) {
    if (location.getWorld() == null) {
      return "unknown";
    }
    return location.getWorld().getName() + " "
        + String.format(java.util.Locale.ROOT, "%.1f %.1f %.1f", location.getX(), location.getY(), location.getZ());
  }

  private static String describeWorlds(LobbyManager lobby) {
    return describeMissingLobbyWorlds(lobby);
  }

  private static String describeMissingLobbyWorlds(LobbyManager lobby) {
    List<String> configured = new ArrayList<>(lobby.config().worlds());
    List<String> loaded = Bukkit.getWorlds().stream().map(World::getName).toList();
    return "no loaded lobby world; configured=" + configured + ", loaded=" + loaded;
  }

  public boolean previewRunning() {
    return previewRunning.get();
  }

  public boolean showLockRunning() {
    return showLockRunning.get();
  }

  public String previewId() {
    return previewId;
  }

  public String lastPreviewStart() {
    return lastPreviewStart;
  }

  public String lastPreviewFailure() {
    return lastPreviewFailure;
  }

  public record PreviewStartResult(boolean success, String message) {
    static PreviewStartResult success(String message) {
      return new PreviewStartResult(true, message);
    }

    static PreviewStartResult failure(String message) {
      return new PreviewStartResult(false, message);
    }
  }
}
