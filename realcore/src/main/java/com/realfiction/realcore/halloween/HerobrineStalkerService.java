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
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.Chunk;
import org.bukkit.Color;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.inventory.EntityEquipment;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.LeatherArmorMeta;
import org.bukkit.inventory.meta.SkullMeta;
import org.bukkit.metadata.MetadataValue;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.util.Vector;

public final class HerobrineStalkerService {
  public static final String SCOREBOARD_TAG = "realcore_herobrine_stalker";
  private static final double DIRECT_LOOK_DOT = 0.982;
  private static final double CLOSE_DISTANCE_SQUARED = 8.0 * 8.0;
  private static final double LOST_DISTANCE_SQUARED = 96.0 * 96.0;
  private static final long SOUND_COOLDOWN_MILLIS = 10_000L;
  private static final long MONITOR_PERIOD_TICKS = 20L;

  private final Plugin plugin;
  private final RealCoreScheduler scheduler;
  private final Logger logger;
  private final NamespacedKey markerKey;
  private final NamespacedKey sightingKey;
  private final Map<UUID, HerobrineSighting> activeSightings = new ConcurrentHashMap<>();
  private final Map<UUID, Instant> playerCooldowns = new ConcurrentHashMap<>();
  private final Map<UUID, Instant> playerSuppressedUntil = new ConcurrentHashMap<>();
  private final Map<UUID, AtomicLong> playerSoundCooldowns = new ConcurrentHashMap<>();
  private final Map<UUID, AtomicLong> playerFootstepCooldowns = new ConcurrentHashMap<>();
  private final Map<UUID, AtomicLong> playerMiningFakeoutCooldowns = new ConcurrentHashMap<>();
  private final Map<UUID, AtomicLong> playerLookAwayCooldowns = new ConcurrentHashMap<>();
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

  public HerobrineStalkerService(Plugin plugin, RealCoreConfig config, RealCoreScheduler scheduler, Logger logger) {
    this.plugin = plugin;
    this.config = config;
    this.scheduler = scheduler;
    this.logger = logger;
    this.markerKey = new NamespacedKey(plugin, "herobrine_stalker");
    this.sightingKey = new NamespacedKey(plugin, "herobrine_stalker_sighting");
  }

  public void start() {
    lifecycleGeneration.incrementAndGet();
    acceptingSightings = false;
    stopTasksOnly();
    cleanupActiveSightings();
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
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
    acceptingSightings = true;
    checkTask = scheduler.runGlobalRepeating(this::checkOnlinePlayers, secondsToTicks(interval), secondsToTicks(interval));
    monitorTask = scheduler.runGlobalRepeating(this::monitorSightings, MONITOR_PERIOD_TICKS, MONITOR_PERIOD_TICKS);
    lastSkipReason = "";
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
        + ", lastSkip=" + blankToNone(lastSkipReason)
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
    if (distanceSq < stalker.minSpawnDistance() * stalker.minSpawnDistance()
        || distanceSq > (stalker.maxSpawnDistance() + 8.0) * (stalker.maxSpawnDistance() + 8.0)) {
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
    if (nearPlayerBaseOrPortalBlock(world, x, y, z, stalker.avoidPlayerBaseBlocksRadius())) {
      return null;
    }
    return spawn;
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

    UUID sightingId = UUID.randomUUID();
    ArmorStand stand = safe.getWorld().spawn(safe, ArmorStand.class, entity -> configureStand(entity, request, safe, sightingId));
    HerobrineSighting sighting = new HerobrineSighting(
        sightingId,
        request.playerUuid(),
        request.playerName(),
        stand.getUniqueId(),
        request.createdAt(),
        request.createdAt().plus(request.linger()),
        request.miningIntent(),
        request.silhouette(),
        stand.getLocation()
    );
    activeSightings.put(request.playerUuid(), sighting);
    sightings.incrementAndGet();
    recordCooldowns(request.playerUuid(), now);
    lastFailure = "";
    debug("Spawned Herobrine sighting " + sighting.sightingId() + " for " + request.playerName()
        + " at " + formatLocation(safe)
        + " linger=" + request.linger().toSeconds() + "s"
        + " mode=" + sightingMode(request)
        + " conditions=" + request.conditions().summary() + ".");
    if (!request.miningIntent() && !request.silhouette()) {
      maybePlaySightingCaveSound(sighting, stalker.caveSoundChanceOnSpawn());
    }
    if (!request.silhouette()) {
      scheduleLightningOmen(sighting, safe);
    }
    scheduleOmenMarker(sighting, safe);
  }

  private String sightingMode(SpawnRequest request) {
    if (request.silhouette()) {
      return "distantSilhouette";
    }
    return request.miningIntent() ? "miningIntent" : "normal";
  }

  private void configureStand(ArmorStand stand, SpawnRequest request, Location safe, UUID sightingId) {
    stand.addScoreboardTag(SCOREBOARD_TAG);
    stand.getPersistentDataContainer().set(markerKey, PersistentDataType.STRING, request.playerUuid().toString());
    stand.getPersistentDataContainer().set(sightingKey, PersistentDataType.STRING, sightingId.toString());
    stand.setPersistent(false);
    stand.setRemoveWhenFarAway(true);
    stand.setCustomName(null);
    stand.setCustomNameVisible(false);
    stand.setVisible(false);
    stand.setInvulnerable(true);
    stand.setSilent(true);
    stand.setGravity(false);
    stand.setCollidable(false);
    stand.setMarker(true);
    stand.setBasePlate(false);
    stand.setArms(true);
    stand.setCanPickupItems(false);
    stand.setRotation(yawToward(safe, request.playerLocation()), 0.0f);
    EntityEquipment equipment = stand.getEquipment();
    if (equipment != null) {
      equipment.setHelmet(herobrineHead());
      equipment.setChestplate(leather(Material.LEATHER_CHESTPLATE, Color.fromRGB(24, 94, 171)));
      equipment.setLeggings(leather(Material.LEATHER_LEGGINGS, Color.fromRGB(34, 61, 150)));
      equipment.setBoots(leather(Material.LEATHER_BOOTS, Color.fromRGB(22, 22, 22)));
      clearDropChancesIfSupported(stand, equipment);
    }
  }

  static void clearDropChancesIfSupported(Entity equipmentOwner, EntityEquipment equipment) {
    if (equipment == null || !supportsEquipmentDropChance(equipmentOwner)) {
      return;
    }
    // Folia/Purpur 26.x rejects drop-chance setters for non-Mob owners such as ArmorStand.
    equipment.setHelmetDropChance(0.0f);
    equipment.setChestplateDropChance(0.0f);
    equipment.setLeggingsDropChance(0.0f);
    equipment.setBootsDropChance(0.0f);
  }

  static boolean supportsEquipmentDropChance(Entity entity) {
    return entity instanceof Mob;
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
      activeSightings.entrySet().removeIf(entry -> removedEntities.contains(entry.getValue().entityUuid()));
      debug("Cleaned " + removedEntities.size() + " stale Herobrine entities in chunk " + chunk.getWorld().getName()
          + " " + chunk.getX() + "," + chunk.getZ() + " (" + reason + ").");
    }
  }

  @SuppressWarnings("deprecation")
  private ItemStack herobrineHead() {
    ItemStack item = new ItemStack(Material.PLAYER_HEAD);
    if (item.getItemMeta() instanceof SkullMeta meta) {
      meta.setOwningPlayer(Bukkit.getOfflinePlayer(config.halloween().herobrineStalker().headOwner()));
      item.setItemMeta(meta);
    }
    return item;
  }

  private ItemStack leather(Material material, Color color) {
    ItemStack item = new ItemStack(material);
    if (item.getItemMeta() instanceof LeatherArmorMeta meta) {
      meta.setColor(color);
      item.setItemMeta(meta);
    }
    return item;
  }

  private float yawToward(Location from, Location target) {
    double dx = target.getX() - from.getX();
    double dz = target.getZ() - from.getZ();
    return (float) Math.toDegrees(Math.atan2(-dx, dz));
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
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    if (sighting.silhouette()) {
      if (roughLookingAt(player, herobrine) || !now.isBefore(sighting.vanishAt())) {
        vanish(sighting, false, "distant silhouette faded");
      }
      return;
    }
    if (sighting.miningIntent() && (roughLookingAt(player, herobrine) || playerLocation.distanceSquared(herobrine) <= CLOSE_DISTANCE_SQUARED)) {
      vanish(sighting, false, "mining intent noticed");
      return;
    }
    if (stalker.vanishWhenSeen() && (playerLocation.distanceSquared(herobrine) <= CLOSE_DISTANCE_SQUARED || lookingAt(player, herobrine))) {
      retreatAndVanish(sighting, playerLocation);
      return;
    }
    if (!now.isBefore(sighting.vanishAt())) {
      vanish(sighting, true, "linger complete");
      return;
    }
    maybePlayDistantFootsteps(player, sighting);
    maybePlayMiningFakeout(player, sighting);
    if (!sighting.miningIntent() && ThreadLocalRandom.current().nextDouble() <= stalker.caveSoundChanceWhileStalking()) {
      long nowMillis = System.currentTimeMillis();
      if (sighting.soundCooldownElapsed(nowMillis, SOUND_COOLDOWN_MILLIS)) {
        playCaveSound(player, null);
      }
    }
  }

  private boolean lookingAt(Player player, Location target) {
    return lookingAt(player, target, DIRECT_LOOK_DOT);
  }

  private void maybePlayDistantFootsteps(Player player, HerobrineSighting sighting) {
    HerobrineDistantFootstepsConfig footsteps = config.halloween().herobrineStalker().distantFootsteps();
    if (!footsteps.enabled()
        || ThreadLocalRandom.current().nextDouble() > footsteps.chance()
        || !sightingActive(sighting)
        || !cooldownReady(playerFootstepCooldowns, player.getUniqueId(), footsteps.cooldown())) {
      return;
    }
    Location soundAt = offsetAroundPlayer(player, footsteps.minDistance(), footsteps.maxDistance(), true);
    player.playSound(soundAt, Sound.BLOCK_STONE_STEP, 0.18f, 0.55f);
  }

  private void maybePlayMiningFakeout(Player player, HerobrineSighting sighting) {
    HerobrineMiningFakeoutConfig fakeout = config.halloween().herobrineStalker().miningFakeout();
    if (!fakeout.enabled()
        || ThreadLocalRandom.current().nextDouble() > fakeout.chance()
        || !sightingActive(sighting)
        || !HerobrineStalkerRules.miningIntentEligible(conditionsFor(player))
        || !cooldownReady(playerMiningFakeoutCooldowns, player.getUniqueId(), fakeout.cooldown())) {
      return;
    }
    Location soundAt = offsetAroundPlayer(player, 6, fakeout.radius(), false);
    soundAt.add(0.0, ThreadLocalRandom.current().nextDouble(-3.0, 1.5), 0.0);
    player.playSound(soundAt, Sound.BLOCK_STONE_BREAK, 0.22f, 0.62f);
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

  private boolean roughLookingAt(Player player, Location target) {
    double dot = HerobrineStalkerRules.dotForViewDegrees(config.halloween().herobrineStalker().miningIntent().vanishViewDegrees());
    return lookingAt(player, target, dot);
  }

  private boolean lookingAt(Player player, Location target, double minDot) {
    Location eye = player.getEyeLocation();
    Vector targetVector = target.clone().add(0, 1.55, 0).toVector();
    return HerobrineStalkerRules.directLook(
        eye.toVector(),
        eye.getDirection(),
        targetVector,
        config.halloween().herobrineStalker().maxSpawnDistance() + 16.0,
        minDot
    );
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
    for (int i = 1; i <= 4; i++) {
      int step = i;
      scheduler.runAtLater(start, () -> stepBackward(sighting, playerLocation), step * 8L);
    }
    scheduler.runAtLater(start, () -> vanish(sighting, true, "seen"), 48L);
  }

  private void stepBackward(HerobrineSighting sighting, Location playerLocation) {
    Location current = sighting.location();
    if (current == null || current.getWorld() == null) {
      return;
    }
    scheduler.runAt(current, () -> stepBackwardAtCurrentLocation(sighting, playerLocation));
  }

  private void stepBackwardAtCurrentLocation(HerobrineSighting sighting, Location playerLocation) {
    if (activeSightings.get(sighting.playerUuid()) != sighting) {
      return;
    }
    Location current = sighting.location();
    if (current == null || current.getWorld() == null) {
      return;
    }
    Entity entity = Bukkit.getEntity(sighting.entityUuid());
    if (!(entity instanceof ArmorStand stand) || !stand.getScoreboardTags().contains(SCOREBOARD_TAG)) {
      return;
    }
    Vector away = current.toVector().subtract(playerLocation.toVector());
    if (away.lengthSquared() < 0.001) {
      away = new Vector(0, 0, 1);
    }
    away.normalize().multiply(0.85);
    Location next = current.clone().add(away);
    if (isSafeStep(next.getWorld(), next.getBlockX(), next.getBlockY(), next.getBlockZ())) {
      stand.teleportAsync(next).thenAccept(success -> {
        if (Boolean.TRUE.equals(success)) {
          scheduler.runAt(next, () -> {
            if (activeSightings.get(sighting.playerUuid()) != sighting) {
              return;
            }
            Entity moved = Bukkit.getEntity(sighting.entityUuid());
            if (moved instanceof ArmorStand movedStand && movedStand.getScoreboardTags().contains(SCOREBOARD_TAG)) {
              movedStand.setRotation(yawToward(next, playerLocation), 0.0f);
              sighting.updateLocation(movedStand.getLocation());
            }
          });
        }
      });
    }
  }

  private boolean isSafeStep(World world, int x, int y, int z) {
    if (world == null || y <= world.getMinHeight() + 1 || y >= world.getMaxHeight() - 2) {
      return false;
    }
    Block ground = world.getBlockAt(x, y - 1, z);
    Block feet = world.getBlockAt(x, y, z);
    Block head = world.getBlockAt(x, y + 1, z);
    return solidGround(ground) && emptyForBody(feet) && emptyForBody(head);
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
      maybePlayPlayerCaveSound(sighting.playerUuid(), config.halloween().herobrineStalker().caveSoundChanceOnVanish(), expectedWorldId);
      maybePlayLookAwayUnease(sighting.playerUuid(), expectedWorldId);
    }
    if (location != null) {
      scheduler.runAt(location, () -> removeEntity(sighting.entityUuid()));
    }
    debug("Herobrine sighting " + sighting.sightingId() + " vanished: " + reason + ".");
  }

  private void removeEntity(UUID entityUuid) {
    Entity entity = Bukkit.getEntity(entityUuid);
    if (entity != null && entity.getScoreboardTags().contains(SCOREBOARD_TAG)) {
      entity.remove();
    }
  }

  private void cleanupActiveSightings() {
    for (HerobrineSighting sighting : List.copyOf(activeSightings.values())) {
      activeSightings.remove(sighting.playerUuid());
      Location location = sighting.location();
      if (location != null) {
        scheduler.runAt(location, () -> removeEntity(sighting.entityUuid()));
      }
    }
    playerSuppressedUntil.clear();
    playerSoundCooldowns.clear();
    playerFootstepCooldowns.clear();
    playerMiningFakeoutCooldowns.clear();
    playerLookAwayCooldowns.clear();
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
    if (radius <= 0) {
      return false;
    }
    int startY = Math.max(world.getMinHeight(), y - 1);
    int endY = Math.min(world.getMaxHeight() - 1, y + 2);
    for (int dx = -radius; dx <= radius; dx++) {
      for (int dz = -radius; dz <= radius; dz++) {
        for (int scanY = startY; scanY <= endY; scanY++) {
          Material type = world.getBlockAt(x + dx, scanY, z + dz).getType();
          if (protectedOrBaseBlock(type)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private boolean protectedOrBaseBlock(Material type) {
    return switch (type) {
      case CHEST, TRAPPED_CHEST, BARREL, FURNACE, BLAST_FURNACE, SMOKER,
          CRAFTING_TABLE, ENCHANTING_TABLE, ANVIL, CHIPPED_ANVIL, DAMAGED_ANVIL,
          BEDROCK, RESPAWN_ANCHOR, END_PORTAL_FRAME, NETHER_PORTAL, END_PORTAL,
          BEACON, HOPPER, DROPPER, DISPENSER -> true;
      default -> type.name().endsWith("_BED") || type.name().endsWith("_DOOR");
    };
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
    scheduler.runAtLater(origin, () -> triggerLightningOmen(sighting), secondsToTicks(delaySeconds));
  }

  private void triggerLightningOmen(HerobrineSighting sighting) {
    if (!sightingActive(sighting)) {
      return;
    }
    Location current = sighting.location();
    if (current == null || current.getWorld() == null) {
      return;
    }
    scheduler.runAt(current, () -> triggerLightningOmenAtCurrentLocation(sighting));
  }

  private void triggerLightningOmenAtCurrentLocation(HerobrineSighting sighting) {
    if (!sightingActive(sighting)) {
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
    for (int i = 0; i < pulses; i++) {
      scheduler.runAtLater(origin, () -> spawnOmenMarkerPulse(sighting, origin), i * 10L);
    }
  }

  private void spawnOmenMarkerPulse(HerobrineSighting sighting, Location origin) {
    if (!sightingActive(sighting) || origin == null || origin.getWorld() == null) {
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
    scheduler.runGlobal(() -> {
      if (!sightingActive(sighting)) {
        return;
      }
      Player player = Bukkit.getPlayer(sighting.playerUuid());
      if (player == null || !player.isOnline() || player.isDead()) {
        return;
      }
      scheduler.runForPlayer(player, () -> {
        if (sightingActive(sighting) && sameWorld(player, sighting.location())) {
          playCaveSound(player, null);
        }
      });
    });
  }

  private void maybePlayPlayerCaveSound(UUID playerUuid, double chance, UUID expectedWorldId) {
    if (chance <= 0.0 || ThreadLocalRandom.current().nextDouble() > chance) {
      return;
    }
    scheduler.runGlobal(() -> {
      Player player = Bukkit.getPlayer(playerUuid);
      if (player != null && player.isOnline() && !player.isDead()) {
        scheduler.runForPlayer(player, () -> playCaveSound(player, expectedWorldId));
      }
    });
  }

  private void maybePlayLookAwayUnease(UUID playerUuid, UUID expectedWorldId) {
    HerobrineLookAwayUneaseConfig unease = config.halloween().herobrineStalker().lookAwayUnease();
    if (!unease.enabled()
        || unease.chance() <= 0.0
        || ThreadLocalRandom.current().nextDouble() > unease.chance()
        || !cooldownReady(playerLookAwayCooldowns, playerUuid, unease.cooldown())) {
      return;
    }
    scheduler.runGlobal(() -> {
      Player player = Bukkit.getPlayer(playerUuid);
      if (player == null || !player.isOnline() || player.isDead()) {
        return;
      }
      scheduler.runForPlayer(player, () -> {
        if (!player.isOnline() || player.isDead() || !sameWorld(player, expectedWorldId)) {
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
      List<Location> candidates
  ) {
  }
}
