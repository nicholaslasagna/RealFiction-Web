package com.realfiction.realcore.halloween;

import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EntityEquipment;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.LeatherArmorMeta;
import org.bukkit.inventory.meta.SkullMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;
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
  private final Map<UUID, HerobrineSighting> activeSightings = new ConcurrentHashMap<>();
  private final Map<UUID, Instant> playerCooldowns = new ConcurrentHashMap<>();
  private final AtomicReference<Instant> globalCooldown = new AtomicReference<>();
  private final AtomicLong sightings = new AtomicLong();
  private final AtomicLong dryRunSightings = new AtomicLong();
  private final AtomicLong failedSpawns = new AtomicLong();
  private final AtomicLong skippedChecks = new AtomicLong();
  private final AtomicLong vanished = new AtomicLong();

  private volatile RealCoreConfig config;
  private volatile ScheduledTaskHandle checkTask;
  private volatile ScheduledTaskHandle monitorTask;
  private volatile String lastSkipReason = "";
  private volatile String lastFailure = "";

  public HerobrineStalkerService(Plugin plugin, RealCoreConfig config, RealCoreScheduler scheduler, Logger logger) {
    this.plugin = plugin;
    this.config = config;
    this.scheduler = scheduler;
    this.logger = logger;
    this.markerKey = new NamespacedKey(plugin, "herobrine_stalker");
  }

  public void start() {
    stopTasksOnly();
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
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
        + ", sightings=" + sightingCount()
        + ", dryRun=" + dryRunSightingCount()
        + ", vanished=" + vanishedCount()
        + ", failed=" + failedSpawnCount()
        + ", skipped=" + skippedCheckCount() + ")";
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
    HerobrineStalkerConfig stalker = current.halloween().herobrineStalker();
    LocalDate today = LocalDate.now();
    if (!current.halloween().stalkerCalendarActive(today)) {
      lastSkipReason = "outside date window";
      return;
    }
    List<Player> players = new ArrayList<>(Bukkit.getOnlinePlayers());
    if (players.isEmpty()) {
      lastSkipReason = "no players online";
      return;
    }
    for (Player player : players) {
      scheduler.runForPlayer(player, () -> evaluatePlayer(player, current, stalker, Instant.now()));
    }
  }

  private void evaluatePlayer(Player player, RealCoreConfig current, HerobrineStalkerConfig stalker, Instant now) {
    if (player == null || !player.isOnline() || player.isDead()) {
      skippedChecks.incrementAndGet();
      return;
    }
    World world = player.getWorld();
    if (world == null || !current.halloween().stalkerAllowedOn(current.serverId(), current.serverGroup(), world.getName())) {
      skippedChecks.incrementAndGet();
      lastSkipReason = "world/server blocked";
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
    if (!HerobrineStalkerRules.shouldAttempt(random, stalker.chancePerCheck())) {
      skippedChecks.incrementAndGet();
      return;
    }

    Location playerLocation = player.getLocation().clone();
    Location eyeLocation = player.getEyeLocation().clone();
    SpawnRequest request = new SpawnRequest(
        playerUuid,
        player.getName(),
        playerLocation,
        eyeLocation,
        conditions,
        now,
        randomLinger(stalker),
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

  private Duration randomLinger(HerobrineStalkerConfig stalker) {
    long min = Math.max(1L, stalker.minLinger().toSeconds());
    long max = Math.max(min, stalker.maxLinger().toSeconds());
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
    if (index >= request.candidates().size()) {
      failedSpawns.incrementAndGet();
      lastFailure = "no safe spawn found";
      debug("No safe Herobrine spawn found for " + request.playerName() + ".");
      return;
    }
    Location candidate = request.candidates().get(index);
    scheduler.runAt(candidate, () -> {
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
    Block ground = world.getBlockAt(x, y - 1, z);
    Block feet = world.getBlockAt(x, y, z);
    Block head = world.getBlockAt(x, y + 1, z);
    if (!solidGround(ground) || !emptyForBody(feet) || !emptyForBody(head)) {
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
      case LAVA, FIRE, SOUL_FIRE, CACTUS, MAGMA_BLOCK, CAMPFIRE, SOUL_CAMPFIRE, POWDER_SNOW -> true;
      default -> false;
    };
  }

  private void spawnOrDryRun(SpawnRequest request, Location safe) {
    HerobrineStalkerConfig stalker = config.halloween().herobrineStalker();
    if (activeSightings.containsKey(request.playerUuid())) {
      return;
    }
    if (stalker.dryRun()) {
      dryRunSightings.incrementAndGet();
      recordCooldowns(request.playerUuid(), request.createdAt());
      debug("Dry-run Herobrine sighting for " + request.playerName()
          + " at " + formatLocation(safe)
          + " conditions=" + request.conditions().summary() + ".");
      return;
    }

    ArmorStand stand = safe.getWorld().spawn(safe, ArmorStand.class, entity -> configureStand(entity, request, safe));
    HerobrineSighting sighting = new HerobrineSighting(
        UUID.randomUUID(),
        request.playerUuid(),
        request.playerName(),
        stand.getUniqueId(),
        request.createdAt(),
        request.createdAt().plus(request.linger()),
        stand.getLocation()
    );
    activeSightings.put(request.playerUuid(), sighting);
    sightings.incrementAndGet();
    recordCooldowns(request.playerUuid(), request.createdAt());
    lastFailure = "";
    debug("Spawned Herobrine sighting " + sighting.sightingId() + " for " + request.playerName()
        + " at " + formatLocation(safe)
        + " linger=" + request.linger().toSeconds() + "s"
        + " conditions=" + request.conditions().summary() + ".");
    maybePlaySound(request.playerUuid(), stalker.caveSoundChanceOnSpawn());
  }

  private void configureStand(ArmorStand stand, SpawnRequest request, Location safe) {
    stand.addScoreboardTag(SCOREBOARD_TAG);
    stand.getPersistentDataContainer().set(markerKey, PersistentDataType.STRING, request.playerUuid().toString());
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
      equipment.setHelmetDropChance(0.0f);
      equipment.setChestplateDropChance(0.0f);
      equipment.setLeggingsDropChance(0.0f);
      equipment.setBootsDropChance(0.0f);
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
    if (stalker.vanishWhenSeen() && (playerLocation.distanceSquared(herobrine) <= CLOSE_DISTANCE_SQUARED || lookingAt(player, herobrine))) {
      retreatAndVanish(sighting, playerLocation);
      return;
    }
    if (!now.isBefore(sighting.vanishAt())) {
      vanish(sighting, true, "linger complete");
      return;
    }
    if (ThreadLocalRandom.current().nextDouble() <= stalker.caveSoundChanceWhileStalking()) {
      long nowMillis = System.currentTimeMillis();
      if (sighting.soundCooldownElapsed(nowMillis, SOUND_COOLDOWN_MILLIS)) {
        playCaveSound(player);
      }
    }
  }

  private boolean lookingAt(Player player, Location target) {
    Location eye = player.getEyeLocation();
    Vector targetVector = target.clone().add(0, 1.55, 0).toVector();
    return HerobrineStalkerRules.directLook(
        eye.toVector(),
        eye.getDirection(),
        targetVector,
        config.halloween().herobrineStalker().maxSpawnDistance() + 16.0,
        DIRECT_LOOK_DOT
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
    if (maybeSound) {
      maybePlaySound(sighting.playerUuid(), config.halloween().herobrineStalker().caveSoundChanceOnVanish());
    }
    Location location = sighting.location();
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
  }

  private void maybePlaySound(UUID playerUuid, double chance) {
    if (chance <= 0.0 || ThreadLocalRandom.current().nextDouble() > chance) {
      return;
    }
    scheduler.runGlobal(() -> {
      Player player = Bukkit.getPlayer(playerUuid);
      if (player != null && player.isOnline()) {
        scheduler.runForPlayer(player, () -> playCaveSound(player));
      }
    });
  }

  private void playCaveSound(Player player) {
    if (player == null || !player.isOnline()) {
      return;
    }
    player.playSound(player.getLocation(), Sound.AMBIENT_CAVE, 0.35f, 0.72f);
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

  private record SpawnRequest(
      UUID playerUuid,
      String playerName,
      Location playerLocation,
      Location eyeLocation,
      SpookyConditions conditions,
      Instant createdAt,
      Duration linger,
      List<Location> candidates
  ) {
  }
}
