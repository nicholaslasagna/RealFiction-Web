package com.realfiction.realcore.halloween;

import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.Chunk;
import org.bukkit.Color;
import org.bukkit.FluidCollisionMode;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.SkullMeta;
import org.bukkit.metadata.MetadataValue;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.util.RayTraceResult;
import org.bukkit.util.Vector;

public final class HerobrineStalkerService {
  public static final String SCOREBOARD_TAG = "realcore_herobrine_stalker";
  public static final String ARMOR_STAND_DROPS_FIX_MARKER = "v2/no-armorstand-dropchance";
  private static final double CLOSE_DISTANCE_SQUARED = 8.0 * 8.0;
  private static final double LOST_DISTANCE_SQUARED = 96.0 * 96.0;
  private static final long SOUND_COOLDOWN_MILLIS = 10_000L;
  private static final Duration DEBUG_FRONT_LINGER = Duration.ofSeconds(30);

  private final Plugin plugin;
  private final RealCoreScheduler scheduler;
  private final Logger logger;
  private final NamespacedKey markerKey;
  private final NamespacedKey sightingKey;
  private final HerobrineAppearanceService appearanceService;
  private final Map<UUID, HerobrineSighting> activeSightings = new ConcurrentHashMap<>();
  private final Map<UUID, Instant> playerCooldowns = new ConcurrentHashMap<>();
  private final Map<UUID, Instant> playerSuppressedUntil = new ConcurrentHashMap<>();
  private final Map<UUID, AtomicLong> playerSoundCooldowns = new ConcurrentHashMap<>();
  private final Map<UUID, AtomicLong> playerFootstepCooldowns = new ConcurrentHashMap<>();
  private final Map<UUID, AtomicLong> playerMiningFakeoutCooldowns = new ConcurrentHashMap<>();
  private final Map<UUID, AtomicLong> playerLookAwayCooldowns = new ConcurrentHashMap<>();
  private final Map<UUID, Instant> playerProximityEffectCooldowns = new ConcurrentHashMap<>();
  private final AtomicReference<Instant> globalCooldown = new AtomicReference<>();
  private final AtomicLong sightings = new AtomicLong();
  private final AtomicLong dryRunSightings = new AtomicLong();
  private final AtomicLong failedSpawns = new AtomicLong();
  private final AtomicLong skippedChecks = new AtomicLong();
  private final AtomicLong vanished = new AtomicLong();
  private final AtomicLong staleCleaned = new AtomicLong();
  private final AtomicLong lifecycleGeneration = new AtomicLong();

  private volatile RealCoreConfig config;
  private volatile ScheduledTaskHandle checkTask;
  private volatile ScheduledTaskHandle monitorTask;
  private volatile boolean acceptingSightings;
  private volatile String lastSkipReason = "";
  private volatile String lastFailure = "";
  private volatile String lastWindowStalkResult = "";
  private volatile String lastDistantOmenResult = "";

  public HerobrineStalkerService(Plugin plugin, RealCoreConfig config, RealCoreScheduler scheduler, Logger logger) {
    this.plugin = plugin;
    this.config = config;
    this.scheduler = scheduler;
    this.logger = logger;
    this.markerKey = new NamespacedKey(plugin, "herobrine_stalker");
    this.sightingKey = new NamespacedKey(plugin, "herobrine_stalker_sighting");
    this.appearanceService = new HerobrineAppearanceService(plugin, scheduler, logger, markerKey, sightingKey, this::herobrineHead);
  }

  public void start() {
    lifecycleGeneration.incrementAndGet();
    acceptingSightings = false;
    stopTasksOnly();
    cleanupActiveSightings();
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    appearanceService.configure(stalker.appearance(), lifecycleGeneration.get());
    scheduler.runGlobal(() -> cleanupNearbyLoadedStaleSightings(stalker));
    if (!config.halloween().enabled() || !stalker.enabled()) {
      lastSkipReason = "disabled by config";
      return;
    }
    if (!stalker.serverAllowed(config.serverId(), config.serverGroup())) {
      lastSkipReason = "server not allowed";
      debug("Halloween Herobrine Stalker disabled on this backend (" + config.serverId() + "/" + config.serverGroup() + ").");
      return;
    }
    long interval = Math.max(5L, stalker.checkInterval().toSeconds());
    long monitorTicks = stalker.vanishOnLook().enabled()
        ? stalker.vanishOnLook().checkIntervalTicks()
        : 20L;
    acceptingSightings = true;
    checkTask = scheduler.runGlobalRepeating(this::checkOnlinePlayers, secondsToTicks(interval), secondsToTicks(interval));
    monitorTask = scheduler.runGlobalRepeating(this::monitorSightings, monitorTicks, monitorTicks);
    lastSkipReason = "";
    logger.info("Herobrine armorstand dropchance guard: " + ARMOR_STAND_DROPS_FIX_MARKER);
    debug("Halloween Herobrine Stalker armed. Window=" + stalker.dateWindow().summary()
        + ", chance=" + stalker.chancePerCheck() + ", dryRun=" + stalker.dryRun() + ".");
  }

  public void reload(RealCoreConfig nextConfig) {
    this.config = nextConfig;
    start();
  }

  public void stop() {
    lifecycleGeneration.incrementAndGet();
    acceptingSightings = false;
    stopTasksOnly();
    cleanupActiveSightings();
    playerCooldowns.clear();
    globalCooldown.set(null);
  }

  public boolean running() {
    return checkTask != null && monitorTask != null;
  }

  public int activeCount() {
    return activeSightings.size();
  }

  public long sightingCount() {
    return sightings.get();
  }

  public long dryRunSightingCount() {
    return dryRunSightings.get();
  }

  public long failedSpawnCount() {
    return failedSpawns.get();
  }

  public long skippedCheckCount() {
    return skippedChecks.get();
  }

  public long vanishedCount() {
    return vanished.get();
  }

  public long staleCleanedCount() {
    return staleCleaned.get();
  }

  public String lastSkipReason() {
    return lastSkipReason;
  }

  public String lastFailure() {
    return lastFailure;
  }

  public List<String> adminStatusLines() {
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    HerobrineAppearanceStatus appearance = appearanceService.status(stalker.appearance());
    List<String> lines = new ArrayList<>();
    lines.add("enabled=" + (config.halloween().enabled() && stalker.enabled()));
    lines.add("dateActive=" + calendarActive(LocalDate.now()));
    lines.add("dryRunMode=" + stalker.dryRun());
    lines.add("active=" + activeCount() + "/" + stalker.maxActiveSightings());
    lines.add("requestedAppearance=" + appearance.requestedMode());
    lines.add("activeAppearance=" + appearance.activeBackend());
    lines.add("protocolLibDetected=" + appearance.protocolLibDetected());
    lines.add("protocolLibSupported=" + appearance.protocolLibSupported());
    lines.add("packetMovement=" + appearance.packetMovementStatus());
    lines.add("activePacketSessions=" + appearance.activePacketSessions());
    lines.add("fallbackReason=" + blankToNone(appearance.fallbackReason()));
    lines.add("skin=" + appearance.skinStatus());
    lines.add("vanishOnLook=" + stalker.vanishOnLook().enabled());
    lines.add("proximityEffect=" + stalker.proximityEffect().enabled());
    lines.add("windowStalk=" + stalker.windowStalk().enabled());
    lines.add("distantOmenStructure=" + stalker.distantOmenStructure().enabled());
    lines.add("adminForcedTests=dateWindowBypassed");
    lines.add("dropChanceGuard=" + ARMOR_STAND_DROPS_FIX_MARKER);
    lines.add("failed=" + failedSpawnCount());
    lines.add("lastFailure=" + blankToNone(lastFailure));
    lines.add("lastSkip=" + blankToNone(lastSkipReason));
    return lines;
  }

  public List<String> adminPacketProbeLines() {
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    List<String> lines = new ArrayList<>();
    HerobrineAppearanceStatus status = appearanceService.status(stalker.appearance());
    lines.add("ProtocolLib detected: " + status.protocolLibDetected());
    if (!status.protocolLibDetected()) {
      lines.add("ProtocolLib supported: false");
      lines.add("fallback reason: ProtocolLib not detected");
      lines.add("skin: " + status.skinStatus());
      return lines;
    }
    try {
      ProtocolLibHerobrinePackets.ProbeReport report = ProtocolLibHerobrinePackets.diagnose(logger);
      lines.set(0, "ProtocolLib detected: " + report.detected());
      lines.add("ProtocolLib supported: " + report.supported());
      boolean playerInfoOk = false;
      boolean spawnOk = false;
      boolean metadataOk = false;
      for (ProtocolLibHerobrinePackets.ProbeCheck check : report.checks()) {
        lines.add(check.summary());
        if ("player info add/update".equals(check.name())) {
          playerInfoOk = check.ok();
        } else if ("spawn packet".equals(check.name())) {
          spawnOk = check.ok();
        } else if ("metadata packet".equals(check.name())) {
          metadataOk = check.ok();
        }
      }
      lines.add("movement mode: " + report.movementMode());
      lines.add("spawn entity type: PLAYER (generic SPAWN_ENTITY; 1.20.2+/protocol 775 fake player path)");
      lines.add("native player-info entry proof: " + (playerInfoOk ? "yes" : "no"));
      lines.add("skin: " + status.skinStatus());
      lines.add("client render confidence: " + ProtocolLibHerobrinePackets.renderConfidence(playerInfoOk, spawnOk, metadataOk));
      lines.add("known limitations: server cannot verify client-side rendering;"
          + " prove it visually with /rf herobrine test spawn packet-front");
      lines.add("fallback reason: " + blankToNone(report.reason()));
    } catch (LinkageError | RuntimeException error) {
      lines.add("ProtocolLib supported: false");
      lines.add("skin: " + status.skinStatus());
      lines.add("fallback reason: " + shortError(error));
    }
    return lines;
  }

  public void adminTestSpawn(Player player, AdminSpawnMode mode, Consumer<AdminCommandResult> callback) {
    if (player == null) {
      complete(callback, AdminCommandResult.failure("player target is required"));
      return;
    }
    scheduler.runForPlayer(player, () -> adminTestSpawnForPlayer(player, mode, callback));
  }

  /**
   * Admin visual truth test: spawns packet Herobrine 6–10 blocks directly in front of the
   * player, facing them, with vanish-on-look/proximity disabled for a fixed 30s linger.
   * Packet-only — never falls back to ArmorStand. Bypasses date window and candidate logic.
   */
  public void adminTestSpawnFront(Player player, boolean particles, Consumer<AdminCommandResult> callback) {
    if (player == null) {
      complete(callback, AdminCommandResult.failure("player target is required"));
      return;
    }
    scheduler.runForPlayer(player, () -> adminTestSpawnFrontForPlayer(player, particles, callback));
  }

  /** Diagnostic report for the target's active sighting: where he is relative to the player. */
  public List<String> adminLocate(Player player) {
    List<String> lines = new ArrayList<>();
    HerobrineSighting sighting = player == null ? null : activeSightings.get(player.getUniqueId());
    if (player == null || sighting == null) {
      lines.add("no active sighting for target");
      lines.add("activePacketSessions=" + appearanceService.activePacketSessions());
      return lines;
    }
    Location herobrine = sighting.location();
    Location eye = player.getEyeLocation();
    lines.add("active sighting=" + sighting.sightingId());
    lines.add("appearance=" + (sighting.appearance() == null ? "unknown" : sighting.appearance().backend()));
    lines.add("debugStare=" + sighting.debugStare());
    lines.add("location=" + formatLocation(herobrine));
    if (herobrine != null && herobrine.getWorld() != null && herobrine.getWorld().equals(player.getWorld())) {
      Vector toTarget = herobrine.clone().add(0, 1.55, 0).toVector().subtract(eye.toVector());
      double viewDegrees = config.halloween().herobrineStalker().vanishOnLook().normalViewDegrees();
      boolean approxInView = HerobrineStalkerRules.directLook(
          eye.toVector(),
          eye.getDirection(),
          herobrine.clone().add(0, 1.55, 0).toVector(),
          256.0,
          HerobrineStalkerRules.dotForViewDegrees(viewDegrees));
      lines.add(String.format(java.util.Locale.ROOT, "distanceFromPlayer=%.1f", herobrine.distance(player.getLocation())));
      lines.add(String.format(java.util.Locale.ROOT, "playerYaw=%.1f playerPitch=%.1f", eye.getYaw(), eye.getPitch()));
      lines.add(String.format(java.util.Locale.ROOT, "directionToHerobrine=%.2f,%.2f,%.2f",
          toTarget.getX(), toTarget.getY(), toTarget.getZ()));
      lines.add("approxInView=" + approxInView + " (view=" + viewDegrees + "deg)");
      lines.add("lineOfSightApprox=" + hasLineOfSightTo(eye, herobrine.clone().add(0, 1.55, 0).toVector()));
    } else {
      lines.add("distanceFromPlayer=unavailable (different world)");
    }
    sighting.appearance().packetDebug().ifPresent(lines::add);
    lines.add("activePacketSessions=" + appearanceService.activePacketSessions());
    lines.add("vanishAt=" + sighting.vanishAt());
    return lines;
  }

  public void adminTestWindow(Player player, Consumer<AdminCommandResult> callback) {
    if (player == null) {
      complete(callback, AdminCommandResult.failure("player target is required"));
      return;
    }
    scheduler.runForPlayer(player, () -> adminTestWindowForPlayer(player, callback));
  }

  public void adminTestOmen(Player player, Consumer<AdminCommandResult> callback) {
    if (player == null) {
      complete(callback, AdminCommandResult.failure("player target is required"));
      return;
    }
    scheduler.runForPlayer(player, () -> adminTestOmenForPlayer(player, callback));
  }

  public AdminCommandResult adminVanish(UUID playerUuid) {
    HerobrineSighting sighting = playerUuid == null ? null : activeSightings.get(playerUuid);
    if (sighting == null) {
      return AdminCommandResult.failure("no active Herobrine sighting for target");
    }
    vanish(sighting, false, "admin_test");
    return AdminCommandResult.success("vanished sighting=" + sighting.sightingId()
        + " reason=admin_test activePacketSessions=" + appearanceService.activePacketSessions());
  }

  public AdminCleanupResult adminCleanup() {
    int sightingsBefore = activeSightings.size();
    int packetBefore = appearanceService.activePacketSessions();
    int fallbackBefore = (int) activeSightings.values().stream()
        .filter(sighting -> sighting.appearance() != null
            && HerobrineAppearanceConfig.MODE_ARMOR_STAND.equals(sighting.appearance().backend()))
        .count();
    cleanupActiveSightings();
    return new AdminCleanupResult(
        sightingsBefore,
        packetBefore,
        fallbackBefore,
        appearanceService.activePacketSessions()
    );
  }

  public boolean calendarActive(LocalDate date) {
    return config.halloween().stalkerCalendarActive(date);
  }

  public String statusSummary() {
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    boolean enabled = config.halloween().enabled() && stalker.enabled();
    boolean dateActive = calendarActive(LocalDate.now());
    String state;
    if (!enabled) {
      state = "disabled";
    } else if (!stalker.serverAllowed(config.serverId(), config.serverGroup())) {
      state = "server blocked";
    } else if (!dateActive) {
      state = "calendar idle";
    } else {
      state = running() ? (stalker.dryRun() ? "dry-run armed" : "armed") : "not running";
    }
    return state + " (enabled=" + enabled
        + ", dateActive=" + dateActive
        + ", window=" + stalker.dateWindow().summary()
        + ", dryRunMode=" + stalker.dryRun()
        + ", active=" + activeCount()
        + "/" + stalker.maxActiveSightings()
        + ", sightings=" + sightingCount()
        + ", dryRun=" + dryRunSightingCount()
        + ", vanished=" + vanishedCount()
        + ", staleCleaned=" + staleCleanedCount()
        + ", failed=" + failedSpawnCount()
        + ", skipped=" + skippedCheckCount()
        + ", " + appearanceService.status(stalker.appearance()).summary()
        + ", vanishOnLook=" + (stalker.vanishOnLook().enabled() ? "on" : "off")
        + "/" + stalker.vanishOnLook().normalViewDegrees()
        + "deg"
        + ", proximityEffect=" + (stalker.proximityEffect().enabled() ? "on" : "off")
        + ", windowStalk=" + (stalker.windowStalk().enabled() ? "on" : "off")
        + ", distantOmenStructure=" + (stalker.distantOmenStructure().enabled() ? "on" : "off")
        + "/particlesOnly=" + stalker.distantOmenStructure().particlesOnly()
        + "/persistentBlocks=" + stalker.distantOmenStructure().persistentBlocks()
        + ", dropChanceGuard=" + ARMOR_STAND_DROPS_FIX_MARKER
        + ", lastSkip=" + blankToNone(lastSkipReason)
        + ", lastWindowStalk=" + blankToNone(lastWindowStalkResult)
        + ", lastDistantOmen=" + blankToNone(lastDistantOmenResult)
        + ", lastFailure=" + blankToNone(lastFailure) + ")";
  }

  private void stopTasksOnly() {
    if (checkTask != null) {
      checkTask.cancel();
      checkTask = null;
    }
    if (monitorTask != null) {
      monitorTask.cancel();
      monitorTask = null;
    }
  }

  private void checkOnlinePlayers() {
    RealCoreConfig current = config;
    if (!acceptingSightings) {
      return;
    }
    HerobrineStalkerConfig stalker = current.halloween().herobrineStalker();
    LocalDate today = LocalDate.now();
    if (!current.halloween().stalkerCalendarActive(today)) {
      lastSkipReason = "outside date window";
      return;
    }
    Instant now = Instant.now();
    playerSuppressedUntil.entrySet().removeIf(entry -> !now.isBefore(entry.getValue()));
    List<Player> players = new ArrayList<>(Bukkit.getOnlinePlayers());
    if (players.isEmpty()) {
      lastSkipReason = "no players online";
      return;
    }
    if (!HerobrineStalkerRules.activeBelowLimit(activeSightings.size(), stalker.maxActiveSightings())) {
      skippedChecks.incrementAndGet();
      lastSkipReason = "max active sightings";
      return;
    }
    for (Player player : players) {
      scheduler.runForPlayer(player, () -> evaluatePlayer(player, current, stalker, Instant.now()));
    }
  }

  private void evaluatePlayer(Player player, RealCoreConfig current, HerobrineStalkerConfig stalker, Instant now) {
    if (!acceptingSightings) {
      return;
    }
    if (player == null || !player.isOnline() || player.isDead()) {
      skippedChecks.incrementAndGet();
      return;
    }
    if (!HerobrineStalkerRules.activeBelowLimit(activeSightings.size(), stalker.maxActiveSightings())) {
      skippedChecks.incrementAndGet();
      lastSkipReason = "max active sightings";
      return;
    }
    World world = player.getWorld();
    if (world == null || !current.halloween().stalkerAllowedOn(current.serverId(), current.serverGroup(), world.getName())) {
      skippedChecks.incrementAndGet();
      lastSkipReason = "world/server blocked";
      return;
    }
    if (shouldSkipPlayerState(player, now)) {
      skippedChecks.incrementAndGet();
      return;
    }
    UUID playerUuid = player.getUniqueId();
    if (activeSightings.containsKey(playerUuid)) {
      skippedChecks.incrementAndGet();
      return;
    }
    if (!HerobrineStalkerRules.cooldownElapsed(now, playerCooldowns.get(playerUuid), stalker.perPlayerCooldown())) {
      skippedChecks.incrementAndGet();
      lastSkipReason = "player cooldown";
      return;
    }
    if (!HerobrineStalkerRules.cooldownElapsed(now, globalCooldown.get(), stalker.globalCooldown())) {
      skippedChecks.incrementAndGet();
      lastSkipReason = "global cooldown";
      return;
    }

    SpookyConditions conditions = conditionsFor(player);
    if (!HerobrineStalkerRules.qualifies(conditions, stalker.requireNightRainMiningOrDarkness())) {
      skippedChecks.incrementAndGet();
      lastSkipReason = "no spooky condition";
      return;
    }

    if (maybeStartWindowStalk(player, stalker, conditions, now)) {
      return;
    }
    if (maybeStartDistantOmenStructure(player, stalker, conditions, now)) {
      return;
    }

    double random = ThreadLocalRandom.current().nextDouble();
    double effectiveChance = HerobrineStalkerRules.effectiveChance(stalker.chancePerCheck(), conditions, stalker.miningIntent());
    if (!HerobrineStalkerRules.shouldAttempt(random, effectiveChance)) {
      skippedChecks.incrementAndGet();
      return;
    }

    Location playerLocation = player.getLocation().clone();
    Location eyeLocation = player.getEyeLocation().clone();
    boolean miningIntent = stalker.miningIntent().enabled() && HerobrineStalkerRules.miningIntentEligible(conditions);
    boolean silhouette = stalker.distantSilhouette().enabled()
        && ThreadLocalRandom.current().nextDouble() <= stalker.distantSilhouette().chance();
    SpawnRequest request = new SpawnRequest(
        playerUuid,
        player.getName(),
        playerLocation,
        eyeLocation,
        conditions,
        now,
        lifecycleGeneration.get(),
        randomLinger(stalker, miningIntent, silhouette),
        miningIntent,
        silhouette,
        false,
        buildCandidates(playerLocation, stalker)
    );
    if (request.candidates().isEmpty()) {
      failedSpawns.incrementAndGet();
      lastFailure = "no spawn candidates";
      return;
    }
    trySpawnCandidate(request, 0);
  }

  private SpookyConditions conditionsFor(Player player) {
    World world = player.getWorld();
    long time = world.getTime();
    boolean night = time >= 13000L && time <= 23000L;
    boolean storm = world.hasStorm() || world.isThundering();
    Location location = player.getLocation();
    int seaLevel = world.getSeaLevel();
    boolean underground = location.getY() < Math.max(world.getMinHeight() + 8, seaLevel - 15);
    Block feet = location.getBlock();
    int highest = world.getHighestBlockYAt(location);
    boolean covered = location.getBlockY() + 4 < highest;
    boolean dark = feet.getLightLevel() <= 7 || feet.getLightFromSky() <= 4;
    return new SpookyConditions(night, storm, underground, covered && dark);
  }

  private Duration randomLinger(HerobrineStalkerConfig stalker, boolean miningIntent, boolean silhouette) {
    if (silhouette) {
      long min = Math.max(1L, stalker.distantSilhouette().minLinger().toSeconds());
      long max = Math.max(min, stalker.distantSilhouette().maxLinger().toSeconds());
      return Duration.ofSeconds(ThreadLocalRandom.current().nextLong(min, max + 1));
    }
    long min = Math.max(1L, stalker.minLinger().toSeconds());
    long max = Math.max(min, stalker.maxLinger().toSeconds());
    if (miningIntent) {
      max = Math.max(min, Math.min(max, stalker.miningIntent().maxLinger().toSeconds()));
    }
    return Duration.ofSeconds(ThreadLocalRandom.current().nextLong(min, max + 1));
  }

  private boolean maybeStartWindowStalk(
      Player player,
      HerobrineStalkerConfig stalker,
      SpookyConditions conditions,
      Instant now
  ) {
    HerobrineWindowStalkConfig window = stalker.windowStalk();
    if (!window.enabled()) {
      return false;
    }
    World world = player.getWorld();
    if (!HerobrineStalkerRules.windowStalkWeatherAllowed(darkOutside(world), rainOrSnow(world), window)) {
      lastWindowStalkResult = "weather/darkness gate";
      return false;
    }
    if (ThreadLocalRandom.current().nextDouble() > window.chance()) {
      return false;
    }
    List<Location> candidates = buildWindowStalkCandidates(player, window);
    if (candidates.isEmpty()) {
      lastWindowStalkResult = "no glass/outside candidate";
      debug("Window stalk rejected for " + player.getName() + ": no glass/outside candidate.");
      return false;
    }
    SpawnRequest request = new SpawnRequest(
        player.getUniqueId(),
        player.getName(),
        player.getLocation().clone(),
        player.getEyeLocation().clone(),
        conditions,
        now,
        lifecycleGeneration.get(),
        window.maxLinger(),
        false,
        false,
        true,
        candidates
    );
    lastWindowStalkResult = "candidate search queued";
    trySpawnCandidate(request, 0);
    return true;
  }

  private List<Location> buildWindowStalkCandidates(Player player, HerobrineWindowStalkConfig window) {
    List<Location> candidates = new ArrayList<>();
    Location eye = player.getEyeLocation().clone();
    List<Vector> directions = windowSearchDirections(eye);
    Set<String> seen = new HashSet<>();
    for (Vector direction : directions) {
      if (candidates.size() >= window.maxCandidateChecks()) {
        break;
      }
      Location candidate = windowCandidateFromDirection(player, eye, direction, window);
      if (candidate == null) {
        continue;
      }
      String key = candidate.getBlockX() + ":" + candidate.getBlockY() + ":" + candidate.getBlockZ();
      if (seen.add(key)) {
        candidates.add(candidate);
      }
    }
    return candidates;
  }

  private List<Vector> windowSearchDirections(Location eye) {
    List<Vector> directions = new ArrayList<>();
    Vector facing = eye.getDirection().clone();
    if (facing.lengthSquared() > 0.0001) {
      directions.add(facing.normalize());
    }
    float yaw = eye.getYaw();
    for (double offset : new double[] {-45, -25, 25, 45, 90, -90, 135, -135, 180}) {
      double radians = Math.toRadians(yaw + offset);
      directions.add(new Vector(-Math.sin(radians), 0.0, Math.cos(radians)).normalize());
    }
    return directions;
  }

  private Location windowCandidateFromDirection(
      Player player,
      Location eye,
      Vector direction,
      HerobrineWindowStalkConfig window
  ) {
    if (eye.getWorld() == null || direction == null || direction.lengthSquared() <= 0.0001) {
      return null;
    }
    World world = eye.getWorld();
    Vector normalized = direction.clone().normalize();
    int searchBlocks = Math.max(3, Math.min(12, window.maxOutsideDistance()));
    for (int step = 1; step <= searchBlocks; step++) {
      Location probe = eye.clone().add(normalized.clone().multiply(step));
      if (!sameChunk(player.getLocation(), probe) || !world.isChunkLoaded(probe.getBlockX() >> 4, probe.getBlockZ() >> 4)) {
        return null;
      }
      Block block = world.getBlockAt(probe);
      Material type = block.getType();
      if (HerobrineStalkerRules.glassLike(type)) {
        if (!outsideAirBeyondGlass(world, block.getLocation(), normalized)) {
          lastWindowStalkResult = "blocked beyond glass";
          return null;
        }
        Location candidate = block.getLocation().add(0.5, 0.0, 0.5)
            .add(normalized.clone().multiply(window.minOutsideDistance()));
        if (!sameChunk(player.getLocation(), candidate)) {
          lastWindowStalkResult = "candidate crosses chunk boundary";
          return null;
        }
        return candidate;
      }
      if (!type.isAir() && type.isSolid() && !block.isPassable()) {
        return null;
      }
    }
    return null;
  }

  private boolean outsideAirBeyondGlass(World world, Location glass, Vector direction) {
    for (int step = 1; step <= 3; step++) {
      Location probe = glass.clone().add(0.5, 0.5, 0.5).add(direction.clone().normalize().multiply(step));
      if (!world.isChunkLoaded(probe.getBlockX() >> 4, probe.getBlockZ() >> 4)) {
        return false;
      }
      Block block = world.getBlockAt(probe);
      if (block.isLiquid() || dangerous(block.getType())) {
        return false;
      }
      if (!emptyForBody(block)) {
        return false;
      }
    }
    return true;
  }

  private boolean maybeStartDistantOmenStructure(
      Player player,
      HerobrineStalkerConfig stalker,
      SpookyConditions conditions,
      Instant now
  ) {
    HerobrineDistantOmenStructureConfig omen = stalker.distantOmenStructure();
    if (!omen.enabled()) {
      return false;
    }
    if (omen.realBlockPlacementRequested() || omen.packetFakeBlocks()) {
      lastDistantOmenResult = "real/fake block omen deferred";
      debug("Distant omen structure skipped for " + player.getName()
          + ": this build only permits particles-only omen structures.");
      return false;
    }
    if (!omen.particlesOnly()) {
      lastDistantOmenResult = "particlesOnly required";
      return false;
    }
    if (conditions.underground() || conditions.darkCave()) {
      lastDistantOmenResult = "not outdoor";
      return false;
    }
    if (ThreadLocalRandom.current().nextDouble() > omen.chance()) {
      return false;
    }
    List<Location> candidates = buildDistantOmenCandidates(player.getLocation().clone(), omen);
    if (candidates.isEmpty()) {
      lastDistantOmenResult = "no candidates";
      return false;
    }
    tryDistantOmenCandidate(player.getUniqueId(), player.getName(), candidates, 0, omen, now, lifecycleGeneration.get());
    return true;
  }

  private List<Location> buildDistantOmenCandidates(Location playerLocation, HerobrineDistantOmenStructureConfig omen) {
    List<Location> candidates = new ArrayList<>();
    if (playerLocation == null || playerLocation.getWorld() == null) {
      return candidates;
    }
    ThreadLocalRandom random = ThreadLocalRandom.current();
    int attempts = omen.maxCandidateChecks();
    for (int i = 0; i < attempts; i++) {
      double distance = random.nextDouble(omen.minDistance(), omen.maxDistance() + 0.01);
      double yaw = playerLocation.getYaw() + random.nextDouble(-70.0, 70.0);
      double radians = Math.toRadians(yaw);
      double x = playerLocation.getX() - Math.sin(radians) * distance;
      double z = playerLocation.getZ() + Math.cos(radians) * distance;
      candidates.add(new Location(playerLocation.getWorld(), x, playerLocation.getY(), z));
    }
    return candidates;
  }

  private void tryDistantOmenCandidate(
      UUID playerUuid,
      String playerName,
      List<Location> candidates,
      int index,
      HerobrineDistantOmenStructureConfig omen,
      Instant now,
      long generation
  ) {
    if (!generationActive(generation)) {
      return;
    }
    if (index >= candidates.size()) {
      lastDistantOmenResult = "no safe open-area candidate";
      debug("Distant omen rejected for " + playerName + ": no safe open-area candidate.");
      return;
    }
    Location candidate = candidates.get(index);
    scheduler.runAt(candidate, () -> {
      if (!generationActive(generation)) {
        return;
      }
      Location safe = findDistantOmenLocation(candidate, omen);
      if (safe == null) {
        tryDistantOmenCandidate(playerUuid, playerName, candidates, index + 1, omen, now, generation);
        return;
      }
      recordCooldowns(playerUuid, now);
      lastDistantOmenResult = "shown at " + formatLocation(safe);
      debug("Distant omen accepted for " + playerName + " at " + formatLocation(safe) + ".");
      showDistantOmenParticles(playerUuid, safe, omen, generation);
    });
  }

  private List<Location> buildCandidates(Location playerLocation, HerobrineStalkerConfig stalker) {
    List<Location> candidates = new ArrayList<>();
    ThreadLocalRandom random = ThreadLocalRandom.current();
    for (int i = 0; i < 12; i++) {
      double distance = random.nextDouble(stalker.minSpawnDistance(), stalker.maxSpawnDistance() + 0.01);
      double yaw = playerLocation.getYaw();
      double offset;
      double roll = random.nextDouble();
      if (roll < 0.60) {
        offset = random.nextDouble(-55.0, 55.0);
      } else if (roll < 0.88) {
        offset = random.nextBoolean() ? random.nextDouble(70.0, 125.0) : random.nextDouble(-125.0, -70.0);
      } else {
        offset = random.nextDouble(145.0, 215.0);
      }
      double radians = Math.toRadians(yaw + offset);
      double x = playerLocation.getX() - Math.sin(radians) * distance;
      double z = playerLocation.getZ() + Math.cos(radians) * distance;
      candidates.add(new Location(playerLocation.getWorld(), x, playerLocation.getY(), z));
    }
    return candidates;
  }

  private void trySpawnCandidate(SpawnRequest request, int index) {
    if (!requestActive(request)) {
      return;
    }
    if (index >= request.candidates().size()) {
      failedSpawns.incrementAndGet();
      lastFailure = "no safe spawn found";
      debug("No safe Herobrine spawn found for " + request.playerName() + ".");
      return;
    }
    Location candidate = request.candidates().get(index);
    scheduler.runAt(candidate, () -> {
      if (!requestActive(request)) {
        return;
      }
      Location safe = findSafeSpawnLocation(candidate, request);
      if (safe == null) {
        trySpawnCandidate(request, index + 1);
        return;
      }
      spawnOrDryRun(request, safe);
    });
  }

  private Location findSafeSpawnLocation(Location candidate, SpawnRequest request) {
    World world = candidate.getWorld();
    if (world == null) {
      return null;
    }
    int baseX = candidate.getBlockX();
    int baseZ = candidate.getBlockZ();
    for (int radius = 0; radius <= 3; radius++) {
      for (int dx = -radius; dx <= radius; dx++) {
        for (int dz = -radius; dz <= radius; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) != radius) {
            continue;
          }
          Location safe = findSafeColumnLocation(world, baseX + dx, baseZ + dz, request);
          if (safe != null) {
            return safe;
          }
        }
      }
    }
    return null;
  }

  private Location findSafeColumnLocation(World world, int x, int z, SpawnRequest request) {
    if (!world.isChunkLoaded(x >> 4, z >> 4)) {
      return null;
    }
    if (request.windowStalk()) {
      int highest = Math.min(world.getMaxHeight() - 2, world.getHighestBlockYAt(x, z) + 1);
      Location surface = safeAt(world, x, highest, z, request);
      return surface != null && windowStalkLocationAllowed(surface, request) ? surface : null;
    }
    int playerY = request.playerLocation().getBlockY();
    boolean cavePreferred = request.conditions().underground() || request.conditions().darkCave();
    if (!cavePreferred) {
      int highest = Math.min(world.getMaxHeight() - 2, world.getHighestBlockYAt(x, z) + 1);
      Location surface = safeAt(world, x, highest, z, request);
      if (surface != null) {
        return surface;
      }
    }
    int top = Math.min(world.getMaxHeight() - 2, playerY + 8);
    int bottom = Math.max(world.getMinHeight() + 2, playerY - 12);
    for (int y = top; y >= bottom; y--) {
      Location safe = safeAt(world, x, y, z, request);
      if (safe != null) {
        return safe;
      }
    }
    return null;
  }

  private Location safeAt(World world, int x, int y, int z, SpawnRequest request) {
    if (y <= world.getMinHeight() + 1 || y >= world.getMaxHeight() - 2) {
      return null;
    }
    Location spawn = new Location(world, x + 0.5, y, z + 0.5);
    if (!world.equals(request.playerLocation().getWorld())) {
      return null;
    }
    double distanceSq = spawn.distanceSquared(request.playerLocation());
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    int minDistance = request.windowStalk()
        ? stalker.windowStalk().minOutsideDistance()
        : stalker.minSpawnDistance();
    double maxDistance = request.windowStalk()
        ? stalker.windowStalk().maxOutsideDistance()
        : stalker.maxSpawnDistance() + 8.0;
    if (distanceSq < minDistance * minDistance || distanceSq > maxDistance * maxDistance) {
      return null;
    }
    if (tooCloseToWorldSpawn(world, spawn, stalker.minDistanceFromWorldSpawn())) {
      return null;
    }
    Block ground = world.getBlockAt(x, y - 1, z);
    Block feet = world.getBlockAt(x, y, z);
    Block head = world.getBlockAt(x, y + 1, z);
    if (!solidGround(ground) || !emptyForBody(feet) || !emptyForBody(head)) {
      return null;
    }
    // TODO: integrate WorldGuard/claim APIs if RealCore adopts one. Until then,
    // this small bounded scan avoids obvious bases/portals without hard dependencies.
    int baseRadius = request.windowStalk()
        ? stalker.windowStalk().avoidPlayerBaseBlocksRadius()
        : stalker.avoidPlayerBaseBlocksRadius();
    if (nearPlayerBaseOrPortalBlock(world, x, y, z, baseRadius, request.windowStalk())) {
      return null;
    }
    return spawn;
  }

  private boolean windowStalkLocationAllowed(Location spawn, SpawnRequest request) {
    if (spawn == null || spawn.getWorld() == null) {
      lastWindowStalkResult = "invalid location";
      return false;
    }
    HerobrineWindowStalkConfig window = config.halloween().herobrineStalker().windowStalk();
    World world = spawn.getWorld();
    if (window.requireDarkOutside() && !darkOutside(world)) {
      lastWindowStalkResult = "outside not dark";
      return false;
    }
    if (window.requireRainOrSnow() && !rainOrSnow(world)) {
      lastWindowStalkResult = "no rain/snow";
      return false;
    }
    if (window.requireGlassLineOfSight() && !lineOfSightAllowsWindowGlass(request.eyeLocation(), spawn)) {
      lastWindowStalkResult = "no glass line of sight";
      return false;
    }
    if (window.minHeadroom() > 2 && !hasAirClearance(world, spawn.getBlockX(), spawn.getBlockY(), spawn.getBlockZ(), window.minHeadroom())) {
      lastWindowStalkResult = "insufficient headroom";
      return false;
    }
    if (!openSkyAt(world, spawn.getBlockX(), spawn.getBlockY(), spawn.getBlockZ())) {
      lastWindowStalkResult = "not outside";
      return false;
    }
    lastWindowStalkResult = "accepted";
    return true;
  }

  private boolean solidGround(Block block) {
    Material type = block.getType();
    return type.isSolid() && !dangerous(type) && !block.isLiquid();
  }

  private boolean emptyForBody(Block block) {
    Material type = block.getType();
    return !block.isLiquid() && !dangerous(type) && (type.isAir() || block.isPassable());
  }

  private boolean dangerous(Material type) {
    return switch (type) {
      case LAVA, FIRE, SOUL_FIRE, CACTUS, MAGMA_BLOCK, CAMPFIRE, SOUL_CAMPFIRE, POWDER_SNOW,
          NETHER_PORTAL, END_PORTAL -> true;
      default -> false;
    };
  }

  private boolean darkOutside(World world) {
    if (world == null) {
      return false;
    }
    long time = world.getTime();
    return time >= 13000L && time <= 23000L;
  }

  private boolean rainOrSnow(World world) {
    return world != null && (world.hasStorm() || world.isThundering());
  }

  private boolean sameChunk(Location first, Location second) {
    return first != null
        && second != null
        && first.getWorld() != null
        && first.getWorld().equals(second.getWorld())
        && (first.getBlockX() >> 4) == (second.getBlockX() >> 4)
        && (first.getBlockZ() >> 4) == (second.getBlockZ() >> 4);
  }

  private boolean openSkyAt(World world, int x, int y, int z) {
    if (world == null || !world.isChunkLoaded(x >> 4, z >> 4)) {
      return false;
    }
    return world.getHighestBlockYAt(x, z) <= y - 1;
  }

  private boolean hasAirClearance(World world, int x, int y, int z, int height) {
    if (world == null) {
      return false;
    }
    int safeHeight = Math.max(2, height);
    for (int dy = 0; dy < safeHeight; dy++) {
      if (!emptyForBody(world.getBlockAt(x, y + dy, z))) {
        return false;
      }
    }
    return true;
  }

  private boolean lineOfSightAllowsWindowGlass(Location fromEye, Location targetFeet) {
    if (fromEye == null || fromEye.getWorld() == null || targetFeet == null || targetFeet.getWorld() == null) {
      return false;
    }
    if (!fromEye.getWorld().equals(targetFeet.getWorld())) {
      return false;
    }
    World world = fromEye.getWorld();
    Vector start = fromEye.toVector();
    Vector end = targetFeet.clone().add(0, 1.55, 0).toVector();
    Vector delta = end.clone().subtract(start);
    double distance = delta.length();
    if (distance <= 0.01 || distance > 48.0) {
      return false;
    }
    Vector step = delta.normalize().multiply(0.35);
    Vector cursor = start.clone();
    boolean sawGlass = false;
    int checks = Math.min(160, (int) Math.ceil(distance / 0.35));
    for (int i = 0; i <= checks; i++) {
      Location probe = cursor.toLocation(world);
      if (!world.isChunkLoaded(probe.getBlockX() >> 4, probe.getBlockZ() >> 4)) {
        return false;
      }
      Material type = world.getBlockAt(probe).getType();
      if (HerobrineStalkerRules.glassLike(type)) {
        sawGlass = true;
      } else if (!type.isAir() && type.isSolid() && !world.getBlockAt(probe).isPassable()) {
        return false;
      }
      cursor.add(step);
    }
    return sawGlass;
  }

  private Location findDistantOmenLocation(Location candidate, HerobrineDistantOmenStructureConfig omen) {
    if (candidate == null || candidate.getWorld() == null || omen == null || !omen.particlesOnly() || omen.realBlockPlacementRequested()) {
      return null;
    }
    World world = candidate.getWorld();
    int x = candidate.getBlockX();
    int z = candidate.getBlockZ();
    if (!world.isChunkLoaded(x >> 4, z >> 4)) {
      return null;
    }
    int y = Math.min(world.getMaxHeight() - 2, world.getHighestBlockYAt(x, z) + 1);
    Location origin = new Location(world, x + 0.5, y, z + 0.5);
    if (tooCloseToWorldSpawn(world, origin, omen.minDistanceFromWorldSpawn())) {
      lastDistantOmenResult = "too close to spawn";
      return null;
    }
    if (omen.requireOpenSky() && !openSkyAt(world, x, y, z)) {
      lastDistantOmenResult = "no open sky";
      return null;
    }
    Block ground = world.getBlockAt(x, y - 1, z);
    if (!solidGround(ground)
        || !naturalOmenGround(ground.getType())
        || !hasAirClearance(world, x, y, z, omen.minHeightClearance())) {
      lastDistantOmenResult = "unsafe ground/clearance";
      return null;
    }
    if (!openAreaAround(world, x, y, z, omen.minOpenRadius(), omen.minHeightClearance())) {
      lastDistantOmenResult = "not open wilderness";
      return null;
    }
    if (nearPlayerBaseOrPortalBlock(world, x, y, z, omen.avoidPlayerBaseBlocksRadius())) {
      lastDistantOmenResult = "near base-like blocks";
      return null;
    }
    return origin;
  }

  private boolean naturalOmenGround(Material type) {
    return switch (type) {
      case GRASS_BLOCK, DIRT, COARSE_DIRT, ROOTED_DIRT, PODZOL, MYCELIUM,
          STONE, DEEPSLATE, TUFF, ANDESITE, DIORITE, GRANITE, CALCITE,
          BLACKSTONE, BASALT, SMOOTH_BASALT, GRAVEL, SAND, RED_SAND,
          MOSS_BLOCK, MUD, PACKED_MUD, SNOW_BLOCK -> true;
      default -> false;
    };
  }

  private boolean openAreaAround(World world, int x, int y, int z, int radius, int clearance) {
    int safeRadius = Math.max(1, radius);
    int safeClearance = Math.max(2, clearance);
    for (int dx = -safeRadius; dx <= safeRadius; dx++) {
      for (int dz = -safeRadius; dz <= safeRadius; dz++) {
        if ((dx * dx) + (dz * dz) > safeRadius * safeRadius) {
          continue;
        }
        int checkX = x + dx;
        int checkZ = z + dz;
        if (!world.isChunkLoaded(checkX >> 4, checkZ >> 4)) {
          return false;
        }
        for (int dy = 0; dy < safeClearance; dy++) {
          Block block = world.getBlockAt(checkX, y + dy, checkZ);
          if (!emptyForBody(block)) {
            return false;
          }
        }
      }
    }
    return true;
  }

  private void showDistantOmenParticles(
      UUID playerUuid,
      Location origin,
      HerobrineDistantOmenStructureConfig omen,
      long generation
  ) {
    AtomicBoolean active = new AtomicBoolean(true);
    int pulses = Math.max(1, (int) Math.min(24, omen.linger().toSeconds() * 2));
    for (int i = 0; i < pulses; i++) {
      scheduler.runGlobalLater(() -> {
        if (!generationActive(generation) || !active.get()) {
          return;
        }
        Player player = Bukkit.getPlayer(playerUuid);
        if (player == null || !player.isOnline() || player.isDead() || !sameWorld(player, origin)) {
          active.set(false);
          return;
        }
        scheduler.runForPlayer(player, () -> {
          if (!generationActive(generation) || !active.get() || !player.isOnline() || player.isDead() || !sameWorld(player, origin)) {
            active.set(false);
            return;
          }
          if (noticedOmenByPlayer(player, origin, omen.maxDistance())) {
            active.set(false);
            lastDistantOmenResult = "vanished when noticed";
            return;
          }
          spawnDistantOmenParticles(player, origin, omen);
        });
      }, i * 10L);
    }
  }

  private boolean noticedOmenByPlayer(Player player, Location origin, int maxDistance) {
    Location eye = player.getEyeLocation();
    return HerobrineStalkerRules.directLook(
        eye.toVector(),
        eye.getDirection(),
        origin.clone().add(0, 2.2, 0).toVector(),
        Math.max(24.0, maxDistance + 12.0),
        HerobrineStalkerRules.dotForViewDegrees(28.0)
    );
  }

  private void spawnDistantOmenParticles(Player player, Location origin, HerobrineDistantOmenStructureConfig omen) {
    Particle.DustOptions ash = new Particle.DustOptions(Color.fromRGB(12, 12, 12), 1.25f);
    Particle.DustOptions red = new Particle.DustOptions(Color.fromRGB(96, 8, 8), 0.8f);
    int height = switch (omen.type()) {
      case "smoke_column" -> 5;
      case "ash_silhouette" -> 4;
      default -> 5;
    };
    for (int y = 0; y < height; y++) {
      Location point = origin.clone().add(0, 0.35 + y * 0.65, 0);
      player.spawnParticle(Particle.SMOKE, point, 5, 0.16, 0.22, 0.16, 0.004);
      player.spawnParticle(Particle.DUST, point, 3, 0.13, 0.14, 0.13, 0.0, ash);
    }
    if ("void_monolith".equals(omen.type())) {
      player.spawnParticle(Particle.DUST, origin.clone().add(0, 2.0, 0), 2, 0.22, 0.08, 0.22, 0.0, red);
    }
  }

  private void spawnOrDryRun(SpawnRequest request, Location safe) {
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    if (!requestActive(request)) {
      return;
    }
    if (activeSightings.containsKey(request.playerUuid())) {
      return;
    }
    if (!HerobrineStalkerRules.activeBelowLimit(activeSightings.size(), stalker.maxActiveSightings())) {
      skippedChecks.incrementAndGet();
      lastSkipReason = "max active sightings";
      return;
    }
    Instant now = Instant.now();
    if (suppressed(request.playerUuid(), now)) {
      skippedChecks.incrementAndGet();
      lastSkipReason = "recent player state change";
      return;
    }
    if (!HerobrineStalkerRules.cooldownElapsed(now, globalCooldown.get(), stalker.globalCooldown())) {
      skippedChecks.incrementAndGet();
      lastSkipReason = "global cooldown";
      return;
    }
    if (stalker.dryRun()) {
      dryRunSightings.incrementAndGet();
      recordCooldowns(request.playerUuid(), now);
      debug("Dry-run Herobrine sighting for " + request.playerName()
          + " at " + formatLocation(safe)
          + " conditions=" + request.conditions().summary() + ".");
      return;
    }
    HerobrineAppearanceConfig appearance = stalker.appearance();
    HerobrineAppearanceService.Selection selection = appearanceService.select(appearance);
    if (selection.backend() == HerobrineAppearanceService.Backend.SKIP) {
      failedSpawns.incrementAndGet();
      lastFailure = selection.reason();
      debug("Skipped Herobrine sighting for " + request.playerName()
          + ": " + selection.reason() + ".");
      return;
    }

    UUID sightingId = UUID.randomUUID();
    if (selection.backend() == HerobrineAppearanceService.Backend.PACKET_NPC) {
      Player player = Bukkit.getPlayer(request.playerUuid());
      if (player == null || !player.isOnline()) {
        failedSpawns.incrementAndGet();
        lastFailure = "viewer offline before packet spawn";
        return;
      }
      scheduler.runForPlayer(player, () -> spawnPacketSighting(request, safe, sightingId, now));
      return;
    }

    spawnArmorStandSighting(request, safe, sightingId, now, selection.reason());
  }

  private void spawnPacketSighting(SpawnRequest request, Location safe, UUID sightingId, Instant now) {
    if (!requestActive(request) || activeSightings.containsKey(request.playerUuid())) {
      return;
    }
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    if (!HerobrineStalkerRules.activeBelowLimit(activeSightings.size(), stalker.maxActiveSightings())) {
      skippedChecks.incrementAndGet();
      lastSkipReason = "max active sightings";
      return;
    }
    try {
      HerobrineAppearanceHandle handle = appearanceService.spawnPacket(
          sightingId,
          request.playerUuid(),
          request.playerName(),
          safe,
          request.playerLocation(),
          stalker.appearance()
      );
      registerSighting(request, handle, now, "");
    } catch (RuntimeException error) {
      failedSpawns.incrementAndGet();
      lastFailure = "packet spawn failed: " + shortError(error);
      debug("Packet Herobrine spawn failed for " + request.playerName() + ": " + shortError(error) + ".");
      if (stalker.appearance().fallbackToArmorStand()) {
        scheduler.runAt(safe, () -> spawnArmorStandSighting(request, safe, sightingId, now, lastFailure));
      }
    }
  }

  private void spawnArmorStandSighting(SpawnRequest request, Location safe, UUID sightingId, Instant now, String fallbackReason) {
    if (!requestActive(request) || activeSightings.containsKey(request.playerUuid())) {
      return;
    }
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    if (!HerobrineStalkerRules.activeBelowLimit(activeSightings.size(), stalker.maxActiveSightings())) {
      skippedChecks.incrementAndGet();
      lastSkipReason = "max active sightings";
      return;
    }
    HerobrineAppearanceHandle handle = appearanceService.spawnArmorStand(
        sightingId,
        request.playerUuid(),
        request.playerLocation(),
        safe
    );
    registerSighting(request, handle, now, fallbackReason);
  }

  private void registerSighting(SpawnRequest request, HerobrineAppearanceHandle handle, Instant now, String fallbackReason) {
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    HerobrineSighting sighting = new HerobrineSighting(
        handle.sightingId(),
        request.playerUuid(),
        request.playerName(),
        handle,
        request.createdAt(),
        request.createdAt().plus(request.linger()),
        request.miningIntent(),
        request.silhouette(),
        request.windowStalk(),
        handle.location()
    );
    HerobrineSighting previous = activeSightings.putIfAbsent(request.playerUuid(), sighting);
    if (previous != null) {
      handle.despawn("duplicate active sighting");
      return;
    }
    sightings.incrementAndGet();
    recordCooldowns(request.playerUuid(), now);
    lastFailure = "";
    debug("Spawned Herobrine sighting " + sighting.sightingId() + " for " + request.playerName()
        + " at " + formatLocation(sighting.location())
        + " linger=" + request.linger().toSeconds() + "s"
        + " mode=" + sightingMode(request)
        + " appearance=" + handle.backend()
        + (fallbackReason == null || fallbackReason.isBlank() ? "" : " fallbackReason=" + fallbackReason)
        + " conditions=" + request.conditions().summary() + ".");
    if (!request.miningIntent() && !request.silhouette()) {
      maybePlaySightingCaveSound(sighting, stalker.caveSoundChanceOnSpawn());
    }
    if (!request.silhouette()) {
      scheduleLightningOmen(sighting, sighting.location());
    }
    scheduleOmenMarker(sighting, sighting.location());
  }

  private String sightingMode(SpawnRequest request) {
    if (request.windowStalk()) {
      return "windowStalk";
    }
    if (request.silhouette()) {
      return "distantSilhouette";
    }
    return request.miningIntent() ? "miningIntent" : "normal";
  }

  private void adminTestSpawnForPlayer(Player player, AdminSpawnMode mode, Consumer<AdminCommandResult> callback) {
    AdminCommandResult gate = adminSpawnGate(player);
    if (!gate.success()) {
      complete(callback, gate);
      return;
    }
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    SpookyConditions conditions = conditionsFor(player);
    Instant now = Instant.now();
    List<Location> candidates = buildCandidates(player.getLocation().clone(), stalker);
    SpawnRequest request = new SpawnRequest(
        player.getUniqueId(),
        player.getName(),
        player.getLocation().clone(),
        player.getEyeLocation().clone(),
        conditions,
        now,
        lifecycleGeneration.get(),
        randomLinger(stalker, false, false),
        false,
        false,
        false,
        candidates
    );
    HerobrineAppearanceConfig appearance = adminAppearanceFor(mode, stalker.appearance());
    adminTrySpawnCandidate(request, 0, appearance, callback);
  }

  private void adminTestSpawnFrontForPlayer(Player player, boolean particles, Consumer<AdminCommandResult> callback) {
    AdminCommandResult gate = adminSpawnGate(player);
    if (!gate.success()) {
      complete(callback, gate);
      return;
    }
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    HerobrineAppearanceConfig appearance = adminAppearanceFor(AdminSpawnMode.PACKET, stalker.appearance());
    HerobrineAppearanceService.Selection selection = appearanceService.select(appearance);
    if (selection.backend() != HerobrineAppearanceService.Backend.PACKET_NPC) {
      complete(callback, AdminCommandResult.failure("packet-front skipped: packet backend unavailable ("
          + blankToNone(selection.reason()) + "); this test never falls back to ArmorStand"));
      return;
    }
    Location base = player.getLocation().clone();
    Location eye = player.getEyeLocation().clone();
    long generation = lifecycleGeneration.get();
    // Block reads for a spot 6-10 blocks ahead happen on that location's region thread,
    // mirroring the candidate flow used everywhere else in this service.
    List<Vector> offsets = frontOffsets(eye.getDirection());
    Location scanAnchor = base.clone().add(offsets.get(0));
    scheduler.runAt(scanAnchor, () -> {
      if (!generationActive(generation)) {
        complete(callback, AdminCommandResult.failure("packet-front skipped: service generation changed"));
        return;
      }
      Location safe = null;
      for (Vector offset : offsets) {
        Location candidate = base.clone().add(offset);
        safe = findFrontSafeLocation(candidate);
        if (safe != null) {
          break;
        }
      }
      if (safe == null) {
        complete(callback, AdminCommandResult.failure(
            "packet-front skipped: no safe ground with headroom 6-10 blocks ahead of view direction"));
        return;
      }
      Location spawnAt = safe;
      Player current = Bukkit.getPlayer(player.getUniqueId());
      if (current == null || !current.isOnline()) {
        complete(callback, AdminCommandResult.failure("packet-front skipped: viewer went offline"));
        return;
      }
      scheduler.runForPlayer(current, () -> adminSpawnFrontSighting(current, spawnAt, appearance, particles, generation, callback));
    });
  }

  private void adminSpawnFrontSighting(
      Player player,
      Location safe,
      HerobrineAppearanceConfig appearance,
      boolean particles,
      long generation,
      Consumer<AdminCommandResult> callback
  ) {
    if (!generationActive(generation) || activeSightings.containsKey(player.getUniqueId())) {
      complete(callback, AdminCommandResult.failure("packet-front skipped: active sighting already changed"));
      return;
    }
    Instant now = Instant.now();
    UUID sightingId = UUID.randomUUID();
    try {
      HerobrineAppearanceHandle handle = appearanceService.spawnPacket(
          sightingId,
          player.getUniqueId(),
          player.getName(),
          safe,
          player.getLocation(),
          appearance
      );
      HerobrineSighting sighting = new HerobrineSighting(
          handle.sightingId(),
          player.getUniqueId(),
          player.getName(),
          handle,
          now,
          now.plus(DEBUG_FRONT_LINGER),
          false,
          false,
          false,
          handle.location()
      );
      sighting.markDebugStare();
      HerobrineSighting previous = activeSightings.putIfAbsent(player.getUniqueId(), sighting);
      if (previous != null) {
        handle.despawn("duplicate active sighting");
        complete(callback, AdminCommandResult.failure("packet-front skipped: player already has active sighting"));
        return;
      }
      sightings.incrementAndGet();
      lastFailure = "";
      if (particles) {
        scheduleFrontDebugParticles(player, safe, generation);
      }
      Location eye = player.getEyeLocation();
      complete(callback, AdminCommandResult.success("spawned visible packet sighting=" + sighting.sightingId()
          + " appearance=" + handle.backend()
          + " activePacketSessions=" + appearanceService.activePacketSessions()
          + " location=" + formatLocation(safe)
          + String.format(java.util.Locale.ROOT, " distance=%.1f", safe.distance(player.getLocation()))
          + String.format(java.util.Locale.ROOT, " playerYaw=%.1f playerPitch=%.1f", eye.getYaw(), eye.getPitch())
          + " skin=" + appearanceService.status(appearance).skinStatus()
          + " lingerSeconds=" + DEBUG_FRONT_LINGER.toSeconds()
          + " vanishOnLookBypassed=true"
          + " particles=" + particles
          + " fallbackReason=none"
          + handle.packetDebug().map(trace -> " " + trace).orElse("")));
    } catch (RuntimeException error) {
      failedSpawns.incrementAndGet();
      lastFailure = "packet-front spawn failed: " + shortError(error);
      complete(callback, AdminCommandResult.failure(lastFailure));
    }
  }

  /** Harmless viewer-only debug particles marking the intended NPC spot (admin tests only). */
  private void scheduleFrontDebugParticles(Player player, Location safe, long generation) {
    for (int i = 0; i < 20; i++) {
      scheduler.runForPlayerLater(player, () -> {
        if (!generationActive(generation) || !player.isOnline() || !sameWorld(player, safe)) {
          return;
        }
        player.spawnParticle(Particle.FLAME, safe.clone().add(0, 1.0, 0), 6, 0.25, 0.5, 0.25, 0.0);
        player.spawnParticle(Particle.END_ROD, safe.clone().add(0, 2.4, 0), 3, 0.1, 0.2, 0.1, 0.0);
      }, i * 10L + 1L);
    }
  }

  /**
   * Front spawn candidate offsets: view direction flattened to the horizon at 8, 6, then 10
   * blocks. Static and pure for tests; falls back to +Z when looking straight up/down.
   */
  static List<Vector> frontOffsets(Vector direction) {
    Vector flat = direction == null ? null : new Vector(direction.getX(), 0.0, direction.getZ());
    if (flat == null || flat.lengthSquared() < 1.0E-4) {
      flat = new Vector(0.0, 0.0, 1.0);
    }
    flat.normalize();
    List<Vector> offsets = new ArrayList<>(3);
    for (double distance : new double[] {8.0, 6.0, 10.0}) {
      offsets.add(flat.clone().multiply(distance));
    }
    return offsets;
  }

  /** Like safeAt but without min-distance/world-spawn/base checks — admin front tests only. */
  private Location findFrontSafeLocation(Location candidate) {
    World world = candidate.getWorld();
    if (world == null || !world.isChunkLoaded(candidate.getBlockX() >> 4, candidate.getBlockZ() >> 4)) {
      return null;
    }
    int x = candidate.getBlockX();
    int z = candidate.getBlockZ();
    int baseY = candidate.getBlockY();
    for (int dy = 2; dy >= -4; dy--) {
      int y = baseY + dy;
      if (y <= world.getMinHeight() + 1 || y >= world.getMaxHeight() - 2) {
        continue;
      }
      Block ground = world.getBlockAt(x, y - 1, z);
      Block feet = world.getBlockAt(x, y, z);
      Block head = world.getBlockAt(x, y + 1, z);
      if (solidGround(ground) && emptyForBody(feet) && emptyForBody(head)) {
        return new Location(world, x + 0.5, y, z + 0.5);
      }
    }
    return null;
  }

  private void adminTestWindowForPlayer(Player player, Consumer<AdminCommandResult> callback) {
    AdminCommandResult gate = adminSpawnGate(player);
    if (!gate.success()) {
      complete(callback, gate);
      return;
    }
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    HerobrineWindowStalkConfig window = stalker.windowStalk();
    if (!window.enabled()) {
      complete(callback, AdminCommandResult.failure("windowStalk skipped: disabled by config"));
      return;
    }
    if (!HerobrineStalkerRules.windowStalkWeatherAllowed(darkOutside(player.getWorld()), rainOrSnow(player.getWorld()), window)) {
      complete(callback, AdminCommandResult.failure("windowStalk skipped: not dark/raining"));
      return;
    }
    List<Location> candidates = buildWindowStalkCandidates(player, window);
    if (candidates.isEmpty()) {
      lastWindowStalkResult = "no glass line of sight";
      complete(callback, AdminCommandResult.failure("windowStalk skipped: no glass line of sight"));
      return;
    }
    Instant now = Instant.now();
    SpawnRequest request = new SpawnRequest(
        player.getUniqueId(),
        player.getName(),
        player.getLocation().clone(),
        player.getEyeLocation().clone(),
        conditionsFor(player),
        now,
        lifecycleGeneration.get(),
        window.maxLinger(),
        false,
        false,
        true,
        candidates
    );
    adminTrySpawnCandidate(request, 0, stalker.appearance(), callback);
  }

  private void adminTestOmenForPlayer(Player player, Consumer<AdminCommandResult> callback) {
    AdminCommandResult gate = adminBaseGate(player);
    if (!gate.success()) {
      complete(callback, gate);
      return;
    }
    HerobrineDistantOmenStructureConfig omen = config.halloween().herobrineStalker().distantOmenStructure();
    if (!omen.enabled()) {
      complete(callback, AdminCommandResult.failure("distantOmen skipped: disabled by config"));
      return;
    }
    if (!omen.particlesOnly() || omen.realBlockPlacementRequested() || omen.packetFakeBlocks()) {
      complete(callback, AdminCommandResult.failure("distantOmen skipped: particles-only mode required"));
      return;
    }
    List<Location> candidates = buildDistantOmenCandidates(player.getLocation().clone(), omen);
    if (candidates.isEmpty()) {
      complete(callback, AdminCommandResult.failure("distantOmen skipped: no open candidates"));
      return;
    }
    adminTryOmenCandidate(player, candidates, 0, omen, lifecycleGeneration.get(), callback);
  }

  private void adminTrySpawnCandidate(
      SpawnRequest request,
      int index,
      HerobrineAppearanceConfig appearance,
      Consumer<AdminCommandResult> callback
  ) {
    if (!requestActive(request)) {
      complete(callback, AdminCommandResult.failure("spawn skipped: service generation changed"));
      return;
    }
    if (index >= request.candidates().size()) {
      failedSpawns.incrementAndGet();
      lastFailure = request.windowStalk() ? blankToNone(lastWindowStalkResult) : "no safe spawn found";
      complete(callback, AdminCommandResult.failure((request.windowStalk() ? "windowStalk" : "spawn")
          + " skipped: " + lastFailure));
      return;
    }
    Location candidate = request.candidates().get(index);
    scheduler.runAt(candidate, () -> {
      if (!requestActive(request)) {
        complete(callback, AdminCommandResult.failure("spawn skipped: service generation changed"));
        return;
      }
      Location safe = findSafeSpawnLocation(candidate, request);
      if (safe == null) {
        adminTrySpawnCandidate(request, index + 1, appearance, callback);
        return;
      }
      adminSpawnOrDryRun(request, safe, appearance, callback);
    });
  }

  private void adminSpawnOrDryRun(
      SpawnRequest request,
      Location safe,
      HerobrineAppearanceConfig appearance,
      Consumer<AdminCommandResult> callback
  ) {
    if (!requestActive(request)) {
      complete(callback, AdminCommandResult.failure("spawn skipped: service generation changed"));
      return;
    }
    if (activeSightings.containsKey(request.playerUuid())) {
      complete(callback, AdminCommandResult.failure("spawn skipped: player already has active sighting"));
      return;
    }
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    if (!HerobrineStalkerRules.activeBelowLimit(activeSightings.size(), stalker.maxActiveSightings())) {
      skippedChecks.incrementAndGet();
      lastSkipReason = "max active sightings";
      complete(callback, AdminCommandResult.failure("spawn skipped: max active sightings"));
      return;
    }
    Instant now = Instant.now();
    if (stalker.dryRun()) {
      dryRunSightings.incrementAndGet();
      recordCooldowns(request.playerUuid(), now);
      complete(callback, AdminCommandResult.success("dry-run sighting=" + UUID.randomUUID()
          + " appearance=none location=" + formatLocation(safe)
          + " note=no packet/entity mutation"));
      return;
    }
    HerobrineAppearanceService.Selection selection = appearanceService.select(appearance);
    if (selection.backend() == HerobrineAppearanceService.Backend.SKIP) {
      failedSpawns.incrementAndGet();
      lastFailure = selection.reason();
      complete(callback, AdminCommandResult.failure("spawn skipped: " + selection.reason()));
      return;
    }
    UUID sightingId = UUID.randomUUID();
    if (selection.backend() == HerobrineAppearanceService.Backend.PACKET_NPC) {
      Player player = Bukkit.getPlayer(request.playerUuid());
      if (player == null || !player.isOnline()) {
        failedSpawns.incrementAndGet();
        lastFailure = "viewer offline before packet spawn";
        complete(callback, AdminCommandResult.failure("packet spawn failed: viewer offline"));
        return;
      }
      scheduler.runForPlayer(player, () -> adminSpawnPacketSighting(request, safe, appearance, sightingId, now, callback));
      return;
    }
    try {
      HerobrineAppearanceHandle handle = appearanceService.spawnArmorStand(
          sightingId,
          request.playerUuid(),
          request.playerLocation(),
          safe
      );
      HerobrineSighting sighting = registerAdminSighting(request, handle, now, selection.reason());
      complete(callback, AdminCommandResult.success("spawned sighting=" + sighting.sightingId()
          + " appearance=" + handle.backend()
          + " fallbackReason=" + blankToNone(selection.reason())
          + " location=" + formatLocation(sighting.location())));
    } catch (RuntimeException error) {
      failedSpawns.incrementAndGet();
      lastFailure = "armor stand spawn failed: " + shortError(error);
      complete(callback, AdminCommandResult.failure(lastFailure));
    }
  }

  private void adminSpawnPacketSighting(
      SpawnRequest request,
      Location safe,
      HerobrineAppearanceConfig appearance,
      UUID sightingId,
      Instant now,
      Consumer<AdminCommandResult> callback
  ) {
    if (!requestActive(request) || activeSightings.containsKey(request.playerUuid())) {
      complete(callback, AdminCommandResult.failure("packet spawn skipped: active sighting already changed"));
      return;
    }
    try {
      HerobrineAppearanceHandle handle = appearanceService.spawnPacket(
          sightingId,
          request.playerUuid(),
          request.playerName(),
          safe,
          request.playerLocation(),
          appearance
      );
      HerobrineSighting sighting = registerAdminSighting(request, handle, now, "");
      complete(callback, AdminCommandResult.success("spawned sighting=" + sighting.sightingId()
          + " appearance=" + handle.backend()
          + " activePacketSessions=" + appearanceService.activePacketSessions()
          + " skin=" + appearanceService.status(appearance).skinStatus()
          + " fallbackReason=none"
          + " location=" + formatLocation(sighting.location())));
    } catch (RuntimeException error) {
      failedSpawns.incrementAndGet();
      lastFailure = "packet spawn failed: " + shortError(error);
      if (appearance.fallbackToArmorStand()) {
        scheduler.runAt(safe, () -> adminSpawnOrDryRun(request, safe,
            new HerobrineAppearanceConfig(
                HerobrineAppearanceConfig.MODE_ARMOR_STAND,
                true,
                appearance.skinOwner(),
                appearance.hideFromTabAfterTicks()),
            callback));
      } else {
        complete(callback, AdminCommandResult.failure(lastFailure));
      }
    }
  }

  private HerobrineSighting registerAdminSighting(
      SpawnRequest request,
      HerobrineAppearanceHandle handle,
      Instant now,
      String fallbackReason
  ) {
    registerSighting(request, handle, now, fallbackReason);
    HerobrineSighting sighting = activeSightings.get(request.playerUuid());
    if (sighting == null) {
      throw new IllegalStateException("sighting registration failed");
    }
    return sighting;
  }

  private void adminTryOmenCandidate(
      Player player,
      List<Location> candidates,
      int index,
      HerobrineDistantOmenStructureConfig omen,
      long generation,
      Consumer<AdminCommandResult> callback
  ) {
    if (!generationActive(generation)) {
      complete(callback, AdminCommandResult.failure("distantOmen skipped: service generation changed"));
      return;
    }
    if (index >= candidates.size()) {
      complete(callback, AdminCommandResult.failure("distantOmen skipped: "
          + blankToNone(lastDistantOmenResult)));
      return;
    }
    Location candidate = candidates.get(index);
    scheduler.runAt(candidate, () -> {
      if (!generationActive(generation)) {
        complete(callback, AdminCommandResult.failure("distantOmen skipped: service generation changed"));
        return;
      }
      Location safe = findDistantOmenLocation(candidate, omen);
      if (safe == null) {
        adminTryOmenCandidate(player, candidates, index + 1, omen, generation, callback);
        return;
      }
      lastDistantOmenResult = "shown at " + formatLocation(safe);
      showDistantOmenParticles(player.getUniqueId(), safe, omen, generation);
      complete(callback, AdminCommandResult.success("distantOmen shown location=" + formatLocation(safe)
          + " particlesOnly=true realBlocks=false"));
    });
  }

  private AdminCommandResult adminSpawnGate(Player player) {
    AdminCommandResult base = adminBaseGate(player);
    if (!base.success()) {
      return base;
    }
    if (!HerobrineStalkerRules.activeBelowLimit(activeSightings.size(), config.halloween().herobrineStalker().maxActiveSightings())) {
      return AdminCommandResult.failure("spawn skipped: max active sightings");
    }
    if (activeSightings.containsKey(player.getUniqueId())) {
      return AdminCommandResult.failure("spawn skipped: player already has active sighting");
    }
    return AdminCommandResult.success("ok");
  }

  private AdminCommandResult adminBaseGate(Player player) {
    if (player == null || !player.isOnline() || player.isDead() || player.getWorld() == null) {
      return AdminCommandResult.failure("target player is not safely available");
    }
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    if (!config.halloween().enabled() || !stalker.enabled()) {
      return AdminCommandResult.failure("Herobrine is disabled by config");
    }
    if (!stalker.serverAllowed(config.serverId(), config.serverGroup())) {
      return AdminCommandResult.failure("server denied by Herobrine config");
    }
    if (!stalker.worldAllowed(player.getWorld().getName())) {
      return AdminCommandResult.failure("world denied by Herobrine config");
    }
    return AdminCommandResult.success("ok");
  }

  private HerobrineAppearanceConfig adminAppearanceFor(AdminSpawnMode mode, HerobrineAppearanceConfig configured) {
    HerobrineAppearanceConfig base = configured == null ? HerobrineAppearanceConfig.defaults("Herobrine") : configured;
    return switch (mode == null ? AdminSpawnMode.CONFIGURED : mode) {
      case PACKET -> new HerobrineAppearanceConfig(
          HerobrineAppearanceConfig.MODE_PACKET_NPC,
          false,
          base.skinOwner(),
          base.hideFromTabAfterTicks());
      case ARMOR_STAND -> new HerobrineAppearanceConfig(
          HerobrineAppearanceConfig.MODE_ARMOR_STAND,
          true,
          base.skinOwner(),
          base.hideFromTabAfterTicks());
      case CONFIGURED -> base;
    };
  }

  private void complete(Consumer<AdminCommandResult> callback, AdminCommandResult result) {
    if (callback != null) {
      callback.accept(result);
    }
  }

  public void suppressPlayer(Player player, String reason) {
    if (player == null) {
      return;
    }
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    Duration grace = stalker.playerStateGrace();
    if (!grace.isZero() && !grace.isNegative()) {
      playerSuppressedUntil.put(player.getUniqueId(), Instant.now().plus(grace));
    }
    lastSkipReason = reason == null || reason.isBlank() ? "player state changed" : reason;
    vanishForPlayer(player.getUniqueId(), lastSkipReason);
  }

  public void vanishForPlayer(UUID playerUuid, String reason) {
    if (playerUuid == null) {
      return;
    }
    HerobrineSighting sighting = activeSightings.get(playerUuid);
    if (sighting != null) {
      vanish(sighting, false, reason == null ? "player state changed" : reason);
    }
  }

  public void cleanupChunk(Chunk chunk, String reason) {
    if (chunk == null) {
      return;
    }
    Set<UUID> removedEntities = new HashSet<>();
    for (Entity entity : chunk.getEntities()) {
      if (isRealCoreHerobrineEntity(entity)) {
        removedEntities.add(entity.getUniqueId());
        entity.remove();
        staleCleaned.incrementAndGet();
      }
    }
    if (!removedEntities.isEmpty()) {
      activeSightings.entrySet().removeIf(entry -> {
        UUID entityUuid = entry.getValue().entityUuid();
        return entityUuid != null && removedEntities.contains(entityUuid);
      });
      debug("Cleaned " + removedEntities.size() + " stale Herobrine entities in chunk " + chunk.getWorld().getName()
          + " " + chunk.getX() + "," + chunk.getZ() + " (" + reason + ").");
    }
  }

  @SuppressWarnings("deprecation")
  private ItemStack herobrineHead() {
    ItemStack item = new ItemStack(Material.PLAYER_HEAD);
    if (item.getItemMeta() instanceof SkullMeta meta) {
      meta.setOwningPlayer(Bukkit.getOfflinePlayer(config.halloween().herobrineStalker().appearance().skinOwner()));
      item.setItemMeta(meta);
    }
    return item;
  }

  private void recordCooldowns(UUID playerUuid, Instant now) {
    playerCooldowns.put(playerUuid, now);
    globalCooldown.set(now);
  }

  private void monitorSightings() {
    if (activeSightings.isEmpty()) {
      return;
    }
    for (HerobrineSighting sighting : List.copyOf(activeSightings.values())) {
      Player player = Bukkit.getPlayer(sighting.playerUuid());
      if (player == null || !player.isOnline()) {
        vanish(sighting, false, "player offline");
        continue;
      }
      scheduler.runForPlayer(player, () -> evaluateSighting(player, sighting, Instant.now()));
    }
  }

  private void evaluateSighting(Player player, HerobrineSighting sighting, Instant now) {
    Location herobrine = sighting.location();
    if (herobrine == null || herobrine.getWorld() == null || !player.isOnline() || player.isDead()) {
      vanish(sighting, false, "invalid target");
      return;
    }
    if (!player.getWorld().equals(herobrine.getWorld())) {
      vanish(sighting, false, "world changed");
      return;
    }
    Location playerLocation = player.getLocation();
    if (playerLocation.distanceSquared(herobrine) > LOST_DISTANCE_SQUARED) {
      vanish(sighting, false, "player moved away");
      return;
    }
    sighting.appearance().face(playerLocation);
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    if (sighting.debugStare()) {
      // Admin visual test: never vanish on look/proximity so the admin can actually stare
      // at him. Linger timeout and the world/offline/distance checks above still apply.
      if (!now.isBefore(sighting.vanishAt())) {
        vanish(sighting, false, "debug linger complete");
      }
      return;
    }
    if (sighting.silhouette()) {
      if (noticedByPlayer(player, herobrine, stalker.vanishOnLook().normalViewDegrees()) || !now.isBefore(sighting.vanishAt())) {
        vanish(sighting, false, "distant silhouette faded");
      }
      return;
    }
    if (sighting.miningIntent() && noticedByPlayer(player, herobrine, stalker.vanishOnLook().miningIntentViewDegrees())) {
      vanish(sighting, false, "mining intent noticed");
      return;
    }
    if (handleProximityEffect(player, sighting, playerLocation, herobrine, now, stalker.proximityEffect())) {
      return;
    }
    boolean canVanishWhenSeen = !sighting.windowStalk() || stalker.windowStalk().vanishOnSeen();
    if (canVanishWhenSeen
        && stalker.vanishOnLook().enabled()
        && noticedByPlayer(player, herobrine, stalker.vanishOnLook().normalViewDegrees())) {
      vanish(sighting, true, "seen");
      return;
    }
    if (canVanishWhenSeen
        && !stalker.vanishOnLook().enabled()
        && stalker.vanishWhenSeen()
        && (playerLocation.distanceSquared(herobrine) <= CLOSE_DISTANCE_SQUARED || lookingAt(player, herobrine))) {
      retreatAndVanish(sighting, playerLocation);
      return;
    }
    if (!now.isBefore(sighting.vanishAt())) {
      vanish(sighting, true, "linger complete");
      return;
    }
    boolean ambiencePlayed = maybePlayDistantFootsteps(player, sighting);
    if (!ambiencePlayed) {
      ambiencePlayed = maybePlayMiningFakeout(player, sighting);
    }
    if (!ambiencePlayed
        && !sighting.miningIntent()
        && ThreadLocalRandom.current().nextDouble() <= stalker.caveSoundChanceWhileStalking()) {
      long nowMillis = System.currentTimeMillis();
      if (sighting.soundCooldownElapsed(nowMillis, SOUND_COOLDOWN_MILLIS)) {
        playCaveSound(player, null);
      }
    }
  }

  private boolean handleProximityEffect(
      Player player,
      HerobrineSighting sighting,
      Location playerLocation,
      Location herobrine,
      Instant now,
      HerobrineProximityEffectConfig proximity
  ) {
    if (proximity == null || !proximity.enabled()) {
      sighting.clearProximityEnteredAt();
      return false;
    }
    if (!HerobrineStalkerRules.insideRadius(playerLocation.distanceSquared(herobrine), proximity.radius())) {
      sighting.clearProximityEnteredAt();
      return false;
    }
    if (!HerobrineStalkerRules.cooldownElapsed(now, playerProximityEffectCooldowns.get(player.getUniqueId()), proximity.cooldown())) {
      return false;
    }
    if (sighting.proximityEnteredAt() == null) {
      sighting.markProximityEnteredAt(now);
      return false;
    }
    if (!HerobrineStalkerRules.sustainedFor(now, sighting.proximityEnteredAt(), proximity.required())) {
      return false;
    }

    PotionEffectType type = proximityEffectType(proximity.effect());
    int durationTicks = (int) Math.max(1L, Math.min(Integer.MAX_VALUE, proximity.duration().toMillis() / 50L));
    player.addPotionEffect(new PotionEffect(type, durationTicks, proximity.amplifier(), false, false, false));
    playerProximityEffectCooldowns.put(player.getUniqueId(), now);
    debug("Applied Herobrine proximity effect to " + player.getName()
        + " effect=" + proximity.effect()
        + " duration=" + proximity.duration().toSeconds() + "s"
        + " sighting=" + sighting.sightingId() + ".");
    if (proximity.vanishAfterApply()) {
      vanish(sighting, false, "proximity darkness");
    }
    return true;
  }

  @SuppressWarnings("deprecation")
  private PotionEffectType proximityEffectType(String configured) {
    PotionEffectType type = PotionEffectType.getByName(configured == null ? "" : configured);
    return type == null ? PotionEffectType.DARKNESS : type;
  }

  private boolean lookingAt(Player player, Location target) {
    return lookingAt(
        player,
        target,
        HerobrineStalkerRules.dotForViewDegrees(config.halloween().herobrineStalker().vanishOnLook().normalViewDegrees())
    );
  }

  private boolean maybePlayDistantFootsteps(Player player, HerobrineSighting sighting) {
    HerobrineDistantFootstepsConfig footsteps = config.halloween().herobrineStalker().distantFootsteps();
    if (!footsteps.enabled()
        || ThreadLocalRandom.current().nextDouble() > footsteps.chance()
        || !sightingActive(sighting)
        || !cooldownReady(playerFootstepCooldowns, player.getUniqueId(), footsteps.cooldown())) {
      return false;
    }
    Location soundAt = offsetAroundPlayer(player, footsteps.minDistance(), footsteps.maxDistance(), true);
    player.playSound(soundAt, Sound.BLOCK_STONE_STEP, 0.18f, 0.55f);
    return true;
  }

  private boolean maybePlayMiningFakeout(Player player, HerobrineSighting sighting) {
    HerobrineMiningFakeoutConfig fakeout = config.halloween().herobrineStalker().miningFakeout();
    if (!fakeout.enabled()
        || ThreadLocalRandom.current().nextDouble() > fakeout.chance()
        || !sightingActive(sighting)
        || !HerobrineStalkerRules.miningIntentEligible(conditionsFor(player))
        || !cooldownReady(playerMiningFakeoutCooldowns, player.getUniqueId(), fakeout.cooldown())) {
      return false;
    }
    Location soundAt = offsetAroundPlayer(player, 6, fakeout.radius(), false);
    soundAt.add(0.0, ThreadLocalRandom.current().nextDouble(-3.0, 1.5), 0.0);
    player.playSound(soundAt, Sound.BLOCK_STONE_BREAK, 0.22f, 0.62f);
    return true;
  }

  private Location offsetAroundPlayer(Player player, int minDistance, int maxDistance, boolean preferBehind) {
    Location base = player.getLocation().clone();
    ThreadLocalRandom random = ThreadLocalRandom.current();
    double min = Math.max(1.0, minDistance);
    double max = Math.max(min + 0.01, maxDistance);
    double distance = random.nextDouble(min, max + 0.01);
    double yaw = base.getYaw();
    double offset = preferBehind
        ? random.nextDouble(115.0, 245.0)
        : random.nextDouble(0.0, 360.0);
    double radians = Math.toRadians(yaw + offset);
    return base.add(-Math.sin(radians) * distance, 0.0, Math.cos(radians) * distance);
  }

  private boolean cooldownReady(Map<UUID, AtomicLong> cooldowns, UUID playerUuid, Duration cooldown) {
    long nowMillis = System.currentTimeMillis();
    long cooldownMillis = Math.max(0L, cooldown == null ? 0L : cooldown.toMillis());
    AtomicLong stored = cooldowns.computeIfAbsent(playerUuid, ignored -> new AtomicLong());
    long last = stored.get();
    if (last > 0 && nowMillis - last < cooldownMillis) {
      return false;
    }
    return stored.compareAndSet(last, nowMillis);
  }

  private boolean lookingAt(Player player, Location target, double minDot) {
    return lookingAt(player, target, minDot, false);
  }

  private boolean noticedByPlayer(Player player, Location target, double viewDegrees) {
    HerobrineVanishOnLookConfig vanishOnLook = config.halloween().herobrineStalker().vanishOnLook();
    if (!vanishOnLook.enabled()) {
      return false;
    }
    return lookingAt(
        player,
        target,
        HerobrineStalkerRules.dotForViewDegrees(viewDegrees),
        vanishOnLook.requireLineOfSight()
    );
  }

  private boolean lookingAt(Player player, Location target, double minDot, boolean requireLineOfSight) {
    Location eye = player.getEyeLocation();
    Vector targetVector = target.clone().add(0, 1.55, 0).toVector();
    boolean inCone = HerobrineStalkerRules.directLook(
        eye.toVector(),
        eye.getDirection(),
        targetVector,
        config.halloween().herobrineStalker().maxSpawnDistance() + 16.0,
        minDot
    );
    if (!inCone || !requireLineOfSight) {
      return inCone;
    }
    return hasLineOfSightTo(eye, targetVector);
  }

  private boolean hasLineOfSightTo(Location eye, Vector targetVector) {
    if (eye == null || eye.getWorld() == null || targetVector == null) {
      return false;
    }
    Vector toTarget = targetVector.clone().subtract(eye.toVector());
    double distance = toTarget.length();
    if (distance <= 0.01) {
      return true;
    }
    RayTraceResult hit = eye.getWorld().rayTraceBlocks(
        eye,
        toTarget.normalize(),
        distance,
        FluidCollisionMode.NEVER,
        true
    );
    return hit == null;
  }

  private void retreatAndVanish(HerobrineSighting sighting, Location playerLocation) {
    if (!sighting.markVanishing()) {
      return;
    }
    Location start = sighting.location();
    if (start == null) {
      activeSightings.remove(sighting.playerUuid());
      return;
    }
    long generation = lifecycleGeneration.get();
    for (int i = 1; i <= 4; i++) {
      int step = i;
      scheduler.runAtLater(start, () -> {
        if (generationActive(generation)) {
          stepBackward(sighting, playerLocation);
        }
      }, step * 8L);
    }
    scheduler.runAtLater(start, () -> {
      if (generationActive(generation)) {
        vanish(sighting, true, "seen");
      }
    }, 48L);
  }

  private void stepBackward(HerobrineSighting sighting, Location playerLocation) {
    if (activeSightings.get(sighting.playerUuid()) != sighting) {
      return;
    }
    sighting.appearance().stepAwayFrom(playerLocation);
  }

  private void vanish(HerobrineSighting sighting, boolean maybeSound, String reason) {
    if (!sighting.markVanishing() && !activeSightings.containsKey(sighting.playerUuid())) {
      return;
    }
    activeSightings.remove(sighting.playerUuid());
    vanished.incrementAndGet();
    Location location = sighting.location();
    UUID expectedWorldId = location == null || location.getWorld() == null ? null : location.getWorld().getUID();
    if (maybeSound) {
      boolean caveQueued = maybePlayPlayerCaveSound(
          sighting.playerUuid(),
          config.halloween().herobrineStalker().caveSoundChanceOnVanish(),
          expectedWorldId);
      if (!caveQueued) {
        maybePlayLookAwayUnease(sighting.playerUuid(), expectedWorldId);
      }
    }
    sighting.appearance().despawn(reason);
    debug("Herobrine sighting " + sighting.sightingId() + " vanished: " + reason + ".");
  }

  private void cleanupActiveSightings() {
    for (HerobrineSighting sighting : List.copyOf(activeSightings.values())) {
      activeSightings.remove(sighting.playerUuid());
      sighting.appearance().despawn("service cleanup");
    }
    appearanceService.cleanupAll("service cleanup");
    playerSuppressedUntil.clear();
    playerSoundCooldowns.clear();
    playerFootstepCooldowns.clear();
    playerMiningFakeoutCooldowns.clear();
    playerLookAwayCooldowns.clear();
    playerProximityEffectCooldowns.clear();
  }

  private boolean shouldSkipPlayerState(Player player, Instant now) {
    if (player.getGameMode() == GameMode.CREATIVE || player.getGameMode() == GameMode.SPECTATOR) {
      lastSkipReason = "creative/spectator player";
      return true;
    }
    if (suppressed(player.getUniqueId(), now)) {
      lastSkipReason = "recent player state change";
      return true;
    }
    if (metadataTrue(player, "vanished") || metadataTrue(player, "vanish")) {
      lastSkipReason = "vanished player";
      return true;
    }
    if (metadataTrue(player, "afk") || metadataTrue(player, "essentials_afk") || metadataTrue(player, "Essentials_afk")) {
      lastSkipReason = "afk player";
      return true;
    }
    if (player.hasPotionEffect(PotionEffectType.INVISIBILITY)) {
      lastSkipReason = "invisible player";
      return true;
    }
    if (guiOpen(player)) {
      lastSkipReason = "player menu open";
      return true;
    }
    return false;
  }

  private boolean suppressed(UUID playerUuid, Instant now) {
    Instant until = playerSuppressedUntil.get(playerUuid);
    if (until == null) {
      return false;
    }
    if (!now.isBefore(until)) {
      playerSuppressedUntil.remove(playerUuid, until);
      return false;
    }
    return true;
  }

  private boolean metadataTrue(Player player, String key) {
    if (!player.hasMetadata(key)) {
      return false;
    }
    for (MetadataValue value : player.getMetadata(key)) {
      if (value.asBoolean()) {
        return true;
      }
    }
    return false;
  }

  private boolean guiOpen(Player player) {
    return player.getOpenInventory() != null
        && player.getOpenInventory().getType() != InventoryType.CRAFTING
        && player.getOpenInventory().getTopInventory().getType() != InventoryType.CRAFTING;
  }

  private boolean tooCloseToWorldSpawn(World world, Location spawn, int minDistance) {
    if (minDistance <= 0) {
      return false;
    }
    Location worldSpawn = world.getSpawnLocation();
    if (!worldSpawn.getWorld().equals(spawn.getWorld())) {
      return false;
    }
    return worldSpawn.distanceSquared(spawn) < (double) minDistance * minDistance;
  }

  private boolean nearPlayerBaseOrPortalBlock(World world, int x, int y, int z, int radius) {
    return nearPlayerBaseOrPortalBlock(world, x, y, z, radius, false);
  }

  private boolean nearPlayerBaseOrPortalBlock(World world, int x, int y, int z, int radius, boolean allowGlassForWindowStalk) {
    if (radius <= 0) {
      return false;
    }
    int startY = Math.max(world.getMinHeight(), y - 1);
    int endY = Math.min(world.getMaxHeight() - 1, y + 2);
    for (int dx = -radius; dx <= radius; dx++) {
      for (int dz = -radius; dz <= radius; dz++) {
        for (int scanY = startY; scanY <= endY; scanY++) {
          Material type = world.getBlockAt(x + dx, scanY, z + dz).getType();
          if (allowGlassForWindowStalk && HerobrineStalkerRules.glassLike(type)) {
            continue;
          }
          if (protectedOrBaseBlock(type)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private boolean protectedOrBaseBlock(Material type) {
    return HerobrineStalkerRules.baseLikeBlock(type);
  }

  private void cleanupNearbyLoadedStaleSightings(HerobrineStalkerConfig stalker) {
    if (!stalker.cleanupStaleSightings() || stalker.startupCleanupMaxChunks() <= 0) {
      return;
    }
    Set<String> scheduled = ConcurrentHashMap.newKeySet();
    AtomicLong scheduledChunks = new AtomicLong();
    for (Player player : Bukkit.getOnlinePlayers()) {
      scheduler.runForPlayer(player, () -> scheduleLoadedChunkCleanupNear(player, stalker, scheduled, scheduledChunks));
    }
  }

  private void scheduleLoadedChunkCleanupNear(
      Player player,
      HerobrineStalkerConfig stalker,
      Set<String> scheduled,
      AtomicLong scheduledChunks
  ) {
    if (player == null || !player.isOnline() || player.getWorld() == null) {
      return;
    }
    World world = player.getWorld();
    int radius = stalker.startupCleanupLoadedChunkRadius();
    int centerX = player.getLocation().getBlockX() >> 4;
    int centerZ = player.getLocation().getBlockZ() >> 4;
    for (int dx = -radius; dx <= radius; dx++) {
      for (int dz = -radius; dz <= radius; dz++) {
        if (scheduledChunks.get() >= stalker.startupCleanupMaxChunks()) {
          return;
        }
        int chunkX = centerX + dx;
        int chunkZ = centerZ + dz;
        String key = world.getUID() + ":" + chunkX + ":" + chunkZ;
        if (!scheduled.add(key)) {
          continue;
        }
        scheduledChunks.incrementAndGet();
        Location center = new Location(world, (chunkX << 4) + 8.0, player.getLocation().getY(), (chunkZ << 4) + 8.0);
        scheduler.runAt(center, () -> cleanupLoadedChunk(world, chunkX, chunkZ, "startup"));
      }
    }
  }

  private void cleanupLoadedChunk(World world, int chunkX, int chunkZ, String reason) {
    if (world == null || !world.isChunkLoaded(chunkX, chunkZ)) {
      return;
    }
    cleanupChunk(world.getChunkAt(chunkX, chunkZ), reason);
  }

  private boolean requestActive(SpawnRequest request) {
    return acceptingSightings && request.generation() == lifecycleGeneration.get();
  }

  private boolean sightingActive(HerobrineSighting sighting) {
    return acceptingSightings
        && sighting != null
        && activeSightings.get(sighting.playerUuid()) == sighting
        && !sighting.vanishing();
  }

  private boolean sightingActive(HerobrineSighting sighting, long generation) {
    return generationActive(generation)
        && sighting != null
        && activeSightings.get(sighting.playerUuid()) == sighting
        && !sighting.vanishing();
  }

  private boolean generationActive(long generation) {
    return acceptingSightings && lifecycleGeneration.get() == generation;
  }

  private boolean isRealCoreHerobrineEntity(Entity entity) {
    return entity != null
        && entity.getScoreboardTags().contains(SCOREBOARD_TAG)
        && (entity.getPersistentDataContainer().has(markerKey, PersistentDataType.STRING)
            || entity.getPersistentDataContainer().has(sightingKey, PersistentDataType.STRING));
  }

  private void scheduleLightningOmen(HerobrineSighting sighting, Location origin) {
    HerobrineLightningOmenConfig omen = config.halloween().herobrineStalker().lightningOmen();
    if (!omen.enabled()
        || omen.chance() <= 0.0
        || ThreadLocalRandom.current().nextDouble() > omen.chance()
        || !sighting.markLightningOmenScheduled()) {
      return;
    }
    long minDelay = Math.max(1L, omen.minDelay().toSeconds());
    long maxDelay = Math.max(minDelay, omen.maxDelay().toSeconds());
    long delaySeconds = ThreadLocalRandom.current().nextLong(minDelay, maxDelay + 1);
    long generation = lifecycleGeneration.get();
    scheduler.runAtLater(origin, () -> triggerLightningOmen(sighting, generation), secondsToTicks(delaySeconds));
  }

  private void triggerLightningOmen(HerobrineSighting sighting, long generation) {
    if (!sightingActive(sighting, generation)) {
      return;
    }
    Location current = sighting.location();
    if (current == null || current.getWorld() == null) {
      return;
    }
    scheduler.runAt(current, () -> triggerLightningOmenAtCurrentLocation(sighting, generation));
  }

  private void triggerLightningOmenAtCurrentLocation(HerobrineSighting sighting, long generation) {
    if (!sightingActive(sighting, generation)) {
      return;
    }
    HerobrineLightningOmenConfig omen = config.halloween().herobrineStalker().lightningOmen();
    if (!omen.enabled()) {
      return;
    }
    Location strike = chooseLightningOmenLocation(sighting.location(), omen.radius());
    if (strike == null) {
      return;
    }
    if (omen.damage() && omen.fire()) {
      strike.getWorld().strikeLightning(strike);
    } else {
      strike.getWorld().strikeLightningEffect(strike);
    }
    debug("Herobrine lightning omen at " + formatLocation(strike)
        + " sighting=" + sighting.sightingId()
        + " destructive=" + (omen.damage() && omen.fire()) + ".");
  }

  private Location chooseLightningOmenLocation(Location center, int radius) {
    if (center == null || center.getWorld() == null) {
      return null;
    }
    World world = center.getWorld();
    ThreadLocalRandom random = ThreadLocalRandom.current();
    double minDistance = Math.min(6.0, Math.max(2.0, radius * 0.35));
    for (int attempt = 0; attempt < 8; attempt++) {
      double distance = random.nextDouble(minDistance, Math.max(minDistance + 0.01, radius + 0.01));
      double angle = random.nextDouble(0.0, Math.PI * 2.0);
      int x = center.getBlockX() + (int) Math.round(Math.cos(angle) * distance);
      int z = center.getBlockZ() + (int) Math.round(Math.sin(angle) * distance);
      if (!world.isChunkLoaded(x >> 4, z >> 4)) {
        continue;
      }
      int y = Math.max(world.getMinHeight() + 2, Math.min(world.getMaxHeight() - 2, center.getBlockY()));
      Block block = world.getBlockAt(x, y, z);
      if (block.isLiquid() || dangerous(block.getType())) {
        continue;
      }
      return new Location(world, x + 0.5, y + 0.5, z + 0.5);
    }
    return null;
  }

  private void scheduleOmenMarker(HerobrineSighting sighting, Location origin) {
    HerobrineOmenMarkerConfig marker = config.halloween().herobrineStalker().omenMarker();
    if (!marker.enabled()
        || !marker.particlesOnly()
        || marker.chance() <= 0.0
        || ThreadLocalRandom.current().nextDouble() > marker.chance()
        || !sighting.markOmenMarkerScheduled()) {
      return;
    }
    int pulses = Math.max(1, (int) Math.min(24, marker.linger().toSeconds() * 2));
    long generation = lifecycleGeneration.get();
    for (int i = 0; i < pulses; i++) {
      scheduler.runAtLater(origin, () -> spawnOmenMarkerPulse(sighting, origin, generation), i * 10L);
    }
  }

  private void spawnOmenMarkerPulse(HerobrineSighting sighting, Location origin, long generation) {
    if (!sightingActive(sighting, generation) || origin == null || origin.getWorld() == null) {
      return;
    }
    World world = origin.getWorld();
    if (!world.isChunkLoaded(origin.getBlockX() >> 4, origin.getBlockZ() >> 4)) {
      return;
    }
    spawnOmenMarkerParticles(origin, config.halloween().herobrineStalker().omenMarker());
  }

  private void spawnOmenMarkerParticles(Location center, HerobrineOmenMarkerConfig marker) {
    World world = center.getWorld();
    if (world == null) {
      return;
    }
    Location base = center.clone();
    switch (marker.type()) {
      case "smoke_cluster" -> world.spawnParticle(Particle.SMOKE, base.clone().add(0, 1.2, 0), 8, 0.35, 0.45, 0.35, 0.01, null, true);
      case "redstone_dust" -> world.spawnParticle(
          Particle.DUST,
          base.clone().add(0, 0.15, 0),
          8,
          0.7,
          0.08,
          0.7,
          0.0,
          new Particle.DustOptions(Color.fromRGB(124, 18, 18), 0.9f),
          true
      );
      case "corrupted_footprints" -> {
        Particle.DustOptions dust = new Particle.DustOptions(Color.fromRGB(15, 15, 15), 0.85f);
        for (int i = 0; i < 5; i++) {
          Location footprint = base.clone().add((i - 2) * 0.45, 0.05, (i % 2 == 0 ? 0.25 : -0.25));
          world.spawnParticle(Particle.DUST, footprint, 2, 0.05, 0.02, 0.05, 0.0, dust, true);
          world.spawnParticle(Particle.SMOKE, footprint.clone().add(0, 0.1, 0), 1, 0.04, 0.04, 0.04, 0.0, null, true);
        }
      }
      default -> {
        Particle.DustOptions ash = new Particle.DustOptions(Color.fromRGB(20, 20, 20), 0.8f);
        for (int i = 0; i < 18; i++) {
          double angle = (Math.PI * 2.0 * i) / 18.0;
          Location point = base.clone().add(Math.cos(angle) * 1.35, 0.08, Math.sin(angle) * 1.35);
          world.spawnParticle(Particle.SMOKE, point, 1, 0.04, 0.03, 0.04, 0.0, null, true);
          if (i % 3 == 0) {
            world.spawnParticle(Particle.DUST, point, 1, 0.02, 0.02, 0.02, 0.0, ash, true);
          }
        }
      }
    }
  }

  private void maybePlaySightingCaveSound(HerobrineSighting sighting, double chance) {
    if (chance <= 0.0 || ThreadLocalRandom.current().nextDouble() > chance || !sightingActive(sighting)) {
      return;
    }
    long generation = lifecycleGeneration.get();
    scheduler.runGlobal(() -> {
      if (!sightingActive(sighting, generation)) {
        return;
      }
      Player player = Bukkit.getPlayer(sighting.playerUuid());
      if (player == null || !player.isOnline() || player.isDead()) {
        return;
      }
      scheduler.runForPlayer(player, () -> {
        if (sightingActive(sighting, generation) && sameWorld(player, sighting.location())) {
          playCaveSound(player, null);
        }
      });
    });
  }

  private boolean maybePlayPlayerCaveSound(UUID playerUuid, double chance, UUID expectedWorldId) {
    if (chance <= 0.0 || ThreadLocalRandom.current().nextDouble() > chance) {
      return false;
    }
    long generation = lifecycleGeneration.get();
    scheduler.runGlobal(() -> {
      if (!generationActive(generation)) {
        return;
      }
      Player player = Bukkit.getPlayer(playerUuid);
      if (player != null && player.isOnline() && !player.isDead()) {
        scheduler.runForPlayer(player, () -> {
          if (generationActive(generation)) {
            playCaveSound(player, expectedWorldId);
          }
        });
      }
    });
    return true;
  }

  private void maybePlayLookAwayUnease(UUID playerUuid, UUID expectedWorldId) {
    HerobrineLookAwayUneaseConfig unease = config.halloween().herobrineStalker().lookAwayUnease();
    if (!unease.enabled()
        || unease.chance() <= 0.0
        || ThreadLocalRandom.current().nextDouble() > unease.chance()
        || !cooldownReady(playerLookAwayCooldowns, playerUuid, unease.cooldown())) {
      return;
    }
    long generation = lifecycleGeneration.get();
    scheduler.runGlobal(() -> {
      if (!generationActive(generation)) {
        return;
      }
      Player player = Bukkit.getPlayer(playerUuid);
      if (player == null || !player.isOnline() || player.isDead()) {
        return;
      }
      scheduler.runForPlayer(player, () -> {
        if (!generationActive(generation) || !player.isOnline() || player.isDead() || !sameWorld(player, expectedWorldId)) {
          return;
        }
        Location behind = offsetAroundPlayer(player, 7, 13, true);
        player.playSound(behind, Sound.AMBIENT_CAVE, 0.24f, 0.62f);
      });
    });
  }

  private void playCaveSound(Player player, UUID expectedWorldId) {
    if (player == null || !player.isOnline()) {
      return;
    }
    if (!sameWorld(player, expectedWorldId)) {
      return;
    }
    long nowMillis = System.currentTimeMillis();
    AtomicLong cooldown = playerSoundCooldowns.computeIfAbsent(player.getUniqueId(), ignored -> new AtomicLong());
    long last = cooldown.get();
    if (last > 0 && nowMillis - last < SOUND_COOLDOWN_MILLIS) {
      return;
    }
    if (!cooldown.compareAndSet(last, nowMillis)) {
      return;
    }
    player.playSound(player.getLocation(), Sound.AMBIENT_CAVE, 0.35f, 0.72f);
  }

  private boolean sameWorld(Player player, Location location) {
    if (location == null || location.getWorld() == null) {
      return false;
    }
    return sameWorld(player, location.getWorld().getUID());
  }

  private boolean sameWorld(Player player, UUID expectedWorldId) {
    if (expectedWorldId == null) {
      return true;
    }
    return player != null && player.getWorld() != null && expectedWorldId.equals(player.getWorld().getUID());
  }

  private void debug(String message) {
    if (config.debug() || config.halloween().herobrineStalker().debug()) {
      logger.info("[Halloween] " + message);
    }
  }

  private long secondsToTicks(long seconds) {
    return Math.max(1L, seconds) * 20L;
  }

  private String formatLocation(Location location) {
    if (location == null || location.getWorld() == null) {
      return "unknown";
    }
    return location.getWorld().getName() + " "
        + location.getBlockX() + "," + location.getBlockY() + "," + location.getBlockZ();
  }

  private String blankToNone(String value) {
    return value == null || value.isBlank() ? "none" : value;
  }

  private String shortError(Throwable error) {
    String message = error.getMessage();
    return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
  }

  public enum AdminSpawnMode {
    CONFIGURED,
    PACKET,
    ARMOR_STAND
  }

  public record AdminCommandResult(boolean success, String message) {
    public static AdminCommandResult success(String message) {
      return new AdminCommandResult(true, message);
    }

    public static AdminCommandResult failure(String message) {
      return new AdminCommandResult(false, message);
    }
  }

  public record AdminCleanupResult(
      int cleanedSightings,
      int cleanedPacketSessions,
      int cleanedFallbackEntities,
      int activePacketSessions
  ) {
    public List<String> lines() {
      return List.of(
          "cleanedSightings=" + cleanedSightings,
          "cleanedPacketSessions=" + cleanedPacketSessions,
          "cleanedFallbackEntities=" + cleanedFallbackEntities,
          "activePacketSessions=" + activePacketSessions
      );
    }
  }

  private record SpawnRequest(
      UUID playerUuid,
      String playerName,
      Location playerLocation,
      Location eyeLocation,
      SpookyConditions conditions,
      Instant createdAt,
      long generation,
      Duration linger,
      boolean miningIntent,
      boolean silhouette,
      boolean windowStalk,
      List<Location> candidates
  ) {
  }
}
