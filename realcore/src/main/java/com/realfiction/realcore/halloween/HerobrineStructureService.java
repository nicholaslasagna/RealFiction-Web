package com.realfiction.realcore.halloween;

import com.realfiction.realcore.halloween.HerobrineStructureRegistry.TrackedBlock;
import com.realfiction.realcore.halloween.HerobrineStructureRegistry.TrackedStructure;
import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.logging.Logger;
import java.util.random.RandomGenerator;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockState;
import org.bukkit.plugin.Plugin;

/**
 * Persistent Herobrine omen structures: tiny, creepy, real-block markers that are fully
 * tracked and reversible.
 *
 * <p>Core safety rule: no block is placed unless it can be tracked and restored. The
 * registry entry is written (and fsynced via atomic replace) BEFORE any block changes;
 * if that write fails, nothing is placed. If placement partially fails, already-placed
 * blocks are rolled back and the registry entry is removed. Only air/trivially
 * replaceable blocks (grass, snow layers, small flowers) are ever overwritten.
 *
 * <p>All block reads/writes must happen on the target's region thread (Folia) — callers
 * are responsible for scheduling; this class never schedules by itself.
 */
public final class HerobrineStructureService {
  /** The only materials a structure may place. */
  static final Set<Material> PLACEMENT_PALETTE = Set.of(
      Material.BLACKSTONE,
      Material.POLISHED_BLACKSTONE,
      Material.BASALT,
      Material.SMOOTH_BASALT,
      Material.DEEPSLATE,
      Material.CRACKED_DEEPSLATE_BRICKS,
      Material.CRYING_OBSIDIAN
  );

  record PlannedBlock(int dx, int dy, int dz, Material material) {
  }

  public record PlacementResult(boolean placed, UUID structureId, String reason, int blockCount) {
    static PlacementResult skipped(String reason) {
      return new PlacementResult(false, null, reason, 0);
    }
  }

  public record RestoreResult(boolean success, int restored, int skipped, String message) {
  }

  /** Injected block access so tracked placement/rollback is unit-testable without a World. */
  interface BlockDataAccess {
    String read(int x, int y, int z);

    void write(int x, int y, int z, String blockData);
  }

  private final Plugin plugin;
  private final Logger logger;
  private final HerobrineStructureRegistry registry;
  private volatile boolean registryLoaded;
  private volatile String lastPlacement = "";
  private volatile String lastSkip = "";
  private volatile String lastFailure = "";

  public HerobrineStructureService(Plugin plugin, Path registryFile, Logger logger) {
    this.plugin = plugin;
    this.logger = logger;
    this.registry = new HerobrineStructureRegistry(registryFile, logger);
  }

  public void loadRegistry() {
    try {
      registry.load();
      registryLoaded = true;
    } catch (RuntimeException error) {
      registryLoaded = false;
      lastFailure = "registry load failed: " + error.getMessage();
    }
  }

  public HerobrineStructureRegistry registry() {
    return registry;
  }

  public boolean registryLoaded() {
    return registryLoaded;
  }

  public String lastPlacement() {
    return lastPlacement;
  }

  public String lastSkip() {
    return lastSkip;
  }

  public String lastFailure() {
    return lastFailure;
  }

  // -- placement ---------------------------------------------------------------

  /**
   * Attempts a persistent placement at an already-vetted omen origin. Must run on the
   * origin's region thread. The origin has already passed the distant-omen safety pipeline
   * (open wilderness, natural ground, clearance, near-base scan); this adds the persistent
   * gates: registry health, per-world cap, spawn distance, claims, containers/beds,
   * natural terrain, and per-block overwrite safety. Any failed gate skips with a reason —
   * blocks are never "mostly" placed.
   */
  public PlacementResult placePersistent(
      Location origin,
      HerobrineDistantOmenStructureConfig omen,
      String reason,
      RandomGenerator random
  ) {
    HerobrinePersistentStructureConfig persistent = omen.persistent();
    if (!omen.persistentPlacementConfigured()) {
      return recordSkip("persistent placement not fully enabled");
    }
    World world = origin == null ? null : origin.getWorld();
    if (world == null) {
      return recordSkip("origin world unavailable");
    }
    if (!registryLoaded) {
      return recordSkip("registry unavailable; refusing to place untracked blocks");
    }
    if (registry.activeCount(world.getName()) >= persistent.maxPerWorld()) {
      return recordSkip("maxPerWorld reached (" + persistent.maxPerWorld() + ")");
    }
    Location spawn = world.getSpawnLocation();
    double spawnDistanceSq = Math.pow(origin.getX() - spawn.getX(), 2) + Math.pow(origin.getZ() - spawn.getZ(), 2);
    if (spawnDistanceSq < (double) persistent.minDistanceFromWorldSpawn() * persistent.minDistanceFromWorldSpawn()) {
      return recordSkip("too close to world spawn");
    }
    String claimIssue = claimGuardIssue(origin, persistent.minDistanceFromClaims());
    if (claimIssue != null) {
      return recordSkip(claimIssue);
    }
    String tileIssue = nearbyTileEntityIssue(world, origin,
        Math.max(persistent.minDistanceFromContainers(), persistent.minDistanceFromPlayerBeds()));
    if (tileIssue != null) {
      return recordSkip(tileIssue);
    }

    int baseX = origin.getBlockX();
    int baseY = origin.getBlockY();
    int baseZ = origin.getBlockZ();
    Block ground = world.getBlockAt(baseX, baseY - 1, baseZ);
    if (persistent.requireNaturalTerrain() && !naturalTerrain(ground.getType())) {
      return recordSkip("ground is not natural terrain: " + ground.getType());
    }

    List<PlannedBlock> plan = monolithPlan(random);
    if (plan.size() > persistent.maxBlocksPerStructure()) {
      plan = plan.subList(0, persistent.maxBlocksPerStructure());
    }
    // Every target block must be trivially replaceable, and rubble must sit on solid ground.
    for (PlannedBlock planned : plan) {
      Block target = world.getBlockAt(baseX + planned.dx(), baseY + planned.dy(), baseZ + planned.dz());
      if (!canOverwrite(target.getType())) {
        return recordSkip("target block not replaceable: " + target.getType()
            + " at " + target.getX() + "," + target.getY() + "," + target.getZ());
      }
      if (planned.dy() == 0) {
        Block under = world.getBlockAt(baseX + planned.dx(), baseY - 1, baseZ + planned.dz());
        if (!under.getType().isSolid()) {
          return recordSkip("no solid ground under structure footprint");
        }
      }
    }

    UUID structureId = UUID.randomUUID();
    List<TrackedBlock> tracked = new ArrayList<>(plan.size());
    for (PlannedBlock planned : plan) {
      int x = baseX + planned.dx();
      int y = baseY + planned.dy();
      int z = baseZ + planned.dz();
      tracked.add(new TrackedBlock(
          x, y, z,
          world.getBlockAt(x, y, z).getBlockData().getAsString(),
          planned.material().createBlockData().getAsString()
      ));
    }
    TrackedStructure structure = new TrackedStructure(
        structureId,
        world.getName(),
        omen.type(),
        baseX, baseY, baseZ,
        List.copyOf(tracked),
        reason,
        Instant.now().toEpochMilli(),
        null
    );
    // Track BEFORE placing: if we cannot persist the record, we must not touch blocks.
    try {
      registry.addAndSave(structure);
    } catch (IOException | RuntimeException error) {
      lastFailure = "tracking failed, no blocks placed: " + error.getMessage();
      return PlacementResult.skipped(lastFailure);
    }
    try {
      placeTracked(tracked, worldAccess(world));
    } catch (RuntimeException error) {
      registry.removeAndSaveBestEffort(structureId);
      lastFailure = "placement failed and was rolled back: " + error.getMessage();
      if (logger != null) {
        logger.warning("Herobrine structure placement rolled back at "
            + world.getName() + " " + baseX + "," + baseY + "," + baseZ + ": " + error.getMessage());
      }
      return PlacementResult.skipped(lastFailure);
    }
    lastPlacement = structureId.toString();
    lastFailure = "";
    if (logger != null) {
      logger.info("Herobrine persistent structure placed id=" + structureId
          + " type=" + omen.type()
          + " world=" + world.getName()
          + " center=" + baseX + "," + baseY + "," + baseZ
          + " blocks=" + tracked.size()
          + " reason=" + reason);
    }
    return new PlacementResult(true, structureId, "", tracked.size());
  }

  /**
   * Writes every planned block, recording nothing new (originals were captured by the
   * caller). On any failure, already-placed blocks are restored in reverse order and the
   * failure is rethrown. Pure orchestration over injected access — unit-testable.
   */
  static void placeTracked(List<TrackedBlock> blocks, BlockDataAccess access) {
    List<TrackedBlock> placed = new ArrayList<>(blocks.size());
    try {
      for (TrackedBlock block : blocks) {
        access.write(block.x(), block.y(), block.z(), block.placedData());
        placed.add(block);
      }
    } catch (RuntimeException error) {
      for (int i = placed.size() - 1; i >= 0; i--) {
        TrackedBlock block = placed.get(i);
        try {
          access.write(block.x(), block.y(), block.z(), block.originalData());
        } catch (RuntimeException rollbackError) {
          error.addSuppressed(rollbackError);
        }
      }
      throw error;
    }
  }

  // -- restore -----------------------------------------------------------------

  /**
   * Restores a structure's original blocks. Must run on the structure's region thread.
   * Safe mode only restores blocks whose current data still matches what we placed
   * (player-modified blocks are skipped and reported); force restores unconditionally.
   */
  public RestoreResult restoreNow(TrackedStructure structure, boolean force) {
    if (structure == null) {
      return new RestoreResult(false, 0, 0, "structure not found");
    }
    if (structure.restored()) {
      return new RestoreResult(false, 0, 0, "structure already restored");
    }
    World world = Bukkit.getWorld(structure.world());
    if (world == null) {
      return new RestoreResult(false, 0, 0, "world not loaded: " + structure.world());
    }
    int restored = 0;
    int skipped = 0;
    BlockDataAccess access = worldAccess(world);
    for (int i = structure.blocks().size() - 1; i >= 0; i--) {
      TrackedBlock block = structure.blocks().get(i);
      if (!world.isChunkLoaded(block.x() >> 4, block.z() >> 4)) {
        skipped++;
        continue;
      }
      String current = access.read(block.x(), block.y(), block.z());
      if (!shouldRestoreBlock(current, block.placedData(), force)) {
        skipped++;
        continue;
      }
      access.write(block.x(), block.y(), block.z(), block.originalData());
      restored++;
    }
    try {
      registry.markRestored(structure.id(), Instant.now().toEpochMilli());
    } catch (IOException | RuntimeException error) {
      return new RestoreResult(false, restored, skipped,
          "blocks restored but registry save failed: " + error.getMessage());
    }
    if (logger != null) {
      logger.info("Herobrine structure restored id=" + structure.id()
          + " restored=" + restored + " skipped=" + skipped + " force=" + force);
    }
    return new RestoreResult(true, restored, skipped,
        "restored " + restored + " block(s), skipped " + skipped + (force ? " (force)" : ""));
  }

  /** Safe restore touches only blocks still matching what we placed; force restores all. */
  static boolean shouldRestoreBlock(String currentData, String placedData, boolean force) {
    if (force) {
      return true;
    }
    return currentData != null && currentData.equals(placedData);
  }

  // -- pure plan + predicates ----------------------------------------------------

  /**
   * The void_monolith plan: a 4-high column (polished blackstone, deepslate, a single
   * crying-obsidian "heart", smooth basalt cap) plus 2-4 rubble blocks scattered on the
   * ground around it. Footprint 3x3, height 4, at most 8 blocks, palette-only.
   */
  static List<PlannedBlock> monolithPlan(RandomGenerator random) {
    List<PlannedBlock> plan = new ArrayList<>();
    plan.add(new PlannedBlock(0, 0, 0, Material.POLISHED_BLACKSTONE));
    plan.add(new PlannedBlock(0, 1, 0, Material.DEEPSLATE));
    plan.add(new PlannedBlock(0, 2, 0, Material.CRYING_OBSIDIAN));
    plan.add(new PlannedBlock(0, 3, 0, Material.SMOOTH_BASALT));

    Material[] rubble = {Material.BLACKSTONE, Material.SMOOTH_BASALT, Material.CRACKED_DEEPSLATE_BRICKS};
    int[][] ring = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {-1, -1}, {1, -1}, {-1, 1}};
    int count = 2 + random.nextInt(3);
    Set<Integer> used = new HashSet<>();
    for (int i = 0; i < count; i++) {
      int slot = random.nextInt(ring.length);
      if (!used.add(slot)) {
        continue;
      }
      plan.add(new PlannedBlock(ring[slot][0], 0, ring[slot][1], rubble[random.nextInt(rubble.length)]));
    }
    return plan;
  }

  /**
   * The only block types a structure may overwrite: air and trivially replaceable ground
   * cover. Everything else — containers, tile entities, beds, doors, redstone, crops,
   * ores, player blocks — is refused by NOT being on this list (fail closed).
   */
  static boolean canOverwrite(Material type) {
    if (type == null) {
      return false;
    }
    // Explicit air constants instead of Material#isAir(): identical result for real
    // blocks, and it keeps this predicate registry-free so tests can exercise it.
    return switch (type) {
      case AIR, CAVE_AIR, VOID_AIR,
          SHORT_GRASS, TALL_GRASS, FERN, LARGE_FERN, DEAD_BUSH, SNOW,
          DANDELION, POPPY, OXEYE_DAISY, CORNFLOWER, AZURE_BLUET -> true;
      default -> false;
    };
  }

  /** Natural wilderness ground the monolith may stand on. */
  static boolean naturalTerrain(Material type) {
    if (type == null) {
      return false;
    }
    return switch (type) {
      case GRASS_BLOCK, DIRT, COARSE_DIRT, ROOTED_DIRT, PODZOL, MYCELIUM,
          STONE, DEEPSLATE, TUFF, ANDESITE, DIORITE, GRANITE, CALCITE,
          GRAVEL, SAND, RED_SAND, MOSS_BLOCK, MUD, PACKED_MUD, SNOW_BLOCK,
          TERRACOTTA, SANDSTONE, RED_SANDSTONE -> true;
      default -> false;
    };
  }

  // -- environment checks --------------------------------------------------------

  /**
   * GriefPrevention soft integration via reflection. Returns null when placement is
   * allowed; a skip reason otherwise. Fail closed: if GriefPrevention is present but
   * the check cannot run, placement is refused.
   */
  private String claimGuardIssue(Location origin, int minDistanceFromClaims) {
    Plugin griefPrevention = Bukkit.getPluginManager().getPlugin("GriefPrevention");
    if (griefPrevention == null || !griefPrevention.isEnabled()) {
      return null;
    }
    try {
      Class<?> gpClass = Class.forName("me.ryanhamshire.GriefPrevention.GriefPrevention");
      Field instanceField = gpClass.getField("instance");
      Object instance = instanceField.get(null);
      Field dataStoreField = gpClass.getField("dataStore");
      Object dataStore = dataStoreField.get(instance);
      Method getClaimAt = null;
      for (Method method : dataStore.getClass().getMethods()) {
        if (method.getName().equals("getClaimAt")
            && method.getParameterCount() >= 2
            && method.getParameterTypes()[0] == Location.class) {
          getClaimAt = method;
          break;
        }
      }
      if (getClaimAt == null) {
        return "claim check unavailable (GriefPrevention API mismatch); refusing placement";
      }
      int radius = Math.max(0, minDistanceFromClaims);
      int[][] samples = {
          {0, 0}, {radius, 0}, {-radius, 0}, {0, radius}, {0, -radius},
          {radius, radius}, {-radius, -radius}, {radius, -radius}, {-radius, radius}
      };
      for (int[] sample : samples) {
        Location probe = origin.clone().add(sample[0], 0, sample[1]);
        Object[] args = new Object[getClaimAt.getParameterCount()];
        args[0] = probe;
        for (int i = 1; i < args.length; i++) {
          Class<?> parameter = getClaimAt.getParameterTypes()[i];
          args[i] = parameter == boolean.class ? Boolean.TRUE : null;
        }
        if (getClaimAt.invoke(dataStore, args) != null) {
          return "claim within " + radius + " blocks";
        }
      }
      return null;
    } catch (ReflectiveOperationException | LinkageError | RuntimeException error) {
      return "claim check failed (" + error.getClass().getSimpleName() + "); refusing placement";
    }
  }

  /**
   * Scans tile entities (containers, beds, signs, spawners, shulkers, ...) in loaded
   * chunks within the radius. Any hit — or any unloaded chunk in range — refuses
   * placement (fail closed: we cannot prove the area is wilderness).
   */
  private String nearbyTileEntityIssue(World world, Location origin, int radius) {
    if (radius <= 0) {
      return null;
    }
    int chunkRadius = (radius >> 4) + 1;
    int originChunkX = origin.getBlockX() >> 4;
    int originChunkZ = origin.getBlockZ() >> 4;
    double radiusSq = (double) radius * radius;
    for (int dx = -chunkRadius; dx <= chunkRadius; dx++) {
      for (int dz = -chunkRadius; dz <= chunkRadius; dz++) {
        int chunkX = originChunkX + dx;
        int chunkZ = originChunkZ + dz;
        if (!world.isChunkLoaded(chunkX, chunkZ)) {
          return "unloaded chunk within protection radius; refusing placement";
        }
        for (BlockState state : world.getChunkAt(chunkX, chunkZ).getTileEntities()) {
          double distSq = Math.pow(state.getX() - origin.getX(), 2)
              + Math.pow(state.getZ() - origin.getZ(), 2);
          if (distSq <= radiusSq) {
            return "player block (" + state.getType() + ") within " + radius + " blocks";
          }
        }
      }
    }
    return null;
  }

  private BlockDataAccess worldAccess(World world) {
    return new BlockDataAccess() {
      @Override
      public String read(int x, int y, int z) {
        return world.getBlockAt(x, y, z).getBlockData().getAsString();
      }

      @Override
      public void write(int x, int y, int z, String blockData) {
        // applyPhysics=false: never trigger neighbor updates that could disturb the area.
        world.getBlockAt(x, y, z).setBlockData(Bukkit.createBlockData(blockData), false);
      }
    };
  }

  private PlacementResult recordSkip(String reason) {
    lastSkip = reason;
    return PlacementResult.skipped(reason);
  }
}
