package com.realfiction.realcore.halloween;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.halloween.HerobrineStructureRegistry.TrackedBlock;
import com.realfiction.realcore.halloween.HerobrineStructureService.PlannedBlock;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.bukkit.Material;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

/**
 * Safety invariants for persistent structures: guarded flags default OFF, the plan is
 * tiny and palette-limited, only trivially replaceable blocks may be overwritten,
 * partial placement rolls back, and safe restore never touches player-modified blocks.
 */
final class HerobrineStructureServiceTest {
  @Test
  void persistentModeDefaultsFullyDisabled() {
    HerobrineDistantOmenStructureConfig omen = HerobrineDistantOmenStructureConfig.defaults();
    assertFalse(omen.persistentBlocks());
    assertFalse(omen.persistent().enabled());
    assertFalse(omen.persistentPlacementConfigured());
    assertTrue(omen.omenPathAllowed(), "particles-only baseline must stay allowed");
  }

  @Test
  void persistentPlacementRequiresBothFlags() throws Exception {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        omen:
          persistentBlocks: true
          persistent:
            enabled: false
        """);
    HerobrineDistantOmenStructureConfig blockedByPersistent =
        HerobrineDistantOmenStructureConfig.from(yaml.getConfigurationSection("omen"));
    assertFalse(blockedByPersistent.persistentPlacementConfigured(),
        "persistentBlocks alone must not enable real blocks");

    yaml.loadFromString("""
        omen:
          persistentBlocks: false
          persistent:
            enabled: true
        """);
    HerobrineDistantOmenStructureConfig blockedByLegacyFlag =
        HerobrineDistantOmenStructureConfig.from(yaml.getConfigurationSection("omen"));
    assertFalse(blockedByLegacyFlag.persistentPlacementConfigured(),
        "persistent.enabled alone must not enable real blocks");

    yaml.loadFromString("""
        omen:
          persistentBlocks: true
          persistent:
            enabled: true
        """);
    HerobrineDistantOmenStructureConfig enabled =
        HerobrineDistantOmenStructureConfig.from(yaml.getConfigurationSection("omen"));
    assertTrue(enabled.persistentPlacementConfigured());
  }

  @Test
  void persistentConfigParsesAndClampsBlockBudget() throws Exception {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        persistent:
          enabled: true
          maxPerWorld: 3
          maxBlocksPerStructure: 999
          minDistanceFromWorldSpawn: 300
          minDistanceFromClaims: 40
          minDistanceFromPlayerBeds: 50
          minDistanceFromContainers: 30
          requireNaturalTerrain: false
          restoreOriginalBlocks: true
          allowAdminCleanup: false
          maxCandidateChecks: 10
        """);
    HerobrinePersistentStructureConfig config =
        HerobrinePersistentStructureConfig.from(yaml.getConfigurationSection("persistent"));
    assertTrue(config.enabled());
    assertEquals(3, config.maxPerWorld());
    assertEquals(16, config.maxBlocksPerStructure(), "block budget must hard-cap at 16");
    assertEquals(300, config.minDistanceFromWorldSpawn());
    assertEquals(40, config.minDistanceFromClaims());
    assertEquals(50, config.minDistanceFromPlayerBeds());
    assertEquals(30, config.minDistanceFromContainers());
    assertFalse(config.requireNaturalTerrain());
    assertFalse(config.allowAdminCleanup());
    assertEquals(10, config.maxCandidateChecks());
  }

  @Test
  void monolithPlanIsTinyPaletteLimitedAndCreepyShaped() {
    for (int seed = 0; seed < 100; seed++) {
      List<PlannedBlock> plan = HerobrineStructureService.monolithPlan(new Random(seed));
      assertTrue(plan.size() <= 16, "plan too large: " + plan.size());
      long crying = 0;
      int maxHeight = 0;
      for (PlannedBlock block : plan) {
        assertTrue(HerobrineStructureService.PLACEMENT_PALETTE.contains(block.material()),
            "material outside palette: " + block.material());
        assertTrue(Math.abs(block.dx()) <= 1 && Math.abs(block.dz()) <= 1, "footprint beyond 3x3");
        assertTrue(block.dy() >= 0 && block.dy() <= 4, "height beyond 5");
        maxHeight = Math.max(maxHeight, block.dy());
        if (block.material() == Material.CRYING_OBSIDIAN) {
          crying++;
        }
      }
      assertEquals(1, crying, "exactly one crying obsidian heart");
      assertTrue(maxHeight >= 3, "monolith should be at least 3 tall");
    }
  }

  @Test
  void canOverwriteOnlyAirAndTrivialGroundCover() {
    assertTrue(HerobrineStructureService.canOverwrite(Material.AIR));
    assertTrue(HerobrineStructureService.canOverwrite(Material.CAVE_AIR));
    assertTrue(HerobrineStructureService.canOverwrite(Material.SHORT_GRASS));
    assertTrue(HerobrineStructureService.canOverwrite(Material.SNOW));
    assertTrue(HerobrineStructureService.canOverwrite(Material.POPPY));

    assertFalse(HerobrineStructureService.canOverwrite(Material.CHEST));
    assertFalse(HerobrineStructureService.canOverwrite(Material.FURNACE));
    assertFalse(HerobrineStructureService.canOverwrite(Material.RED_BED));
    assertFalse(HerobrineStructureService.canOverwrite(Material.OAK_DOOR));
    assertFalse(HerobrineStructureService.canOverwrite(Material.RAIL));
    assertFalse(HerobrineStructureService.canOverwrite(Material.SPAWNER));
    assertFalse(HerobrineStructureService.canOverwrite(Material.OAK_SIGN));
    assertFalse(HerobrineStructureService.canOverwrite(Material.RESPAWN_ANCHOR));
    assertFalse(HerobrineStructureService.canOverwrite(Material.WATER));
    assertFalse(HerobrineStructureService.canOverwrite(Material.LAVA));
    assertFalse(HerobrineStructureService.canOverwrite(Material.DIAMOND_ORE));
    assertFalse(HerobrineStructureService.canOverwrite(Material.GLASS));
    assertFalse(HerobrineStructureService.canOverwrite(Material.STONE));
    assertFalse(HerobrineStructureService.canOverwrite(null));
  }

  @Test
  void placeTrackedRollsBackOnPartialFailure() {
    Map<String, String> world = new HashMap<>();
    world.put("0,0,0", "air");
    world.put("0,1,0", "air");
    world.put("0,2,0", "air");
    HerobrineStructureService.BlockDataAccess access = new HerobrineStructureService.BlockDataAccess() {
      @Override
      public String read(int x, int y, int z) {
        return world.get(x + "," + y + "," + z);
      }

      @Override
      public void write(int x, int y, int z, String blockData) {
        if (y == 2) {
          throw new IllegalStateException("simulated failure on third block");
        }
        world.put(x + "," + y + "," + z, blockData);
      }
    };
    List<TrackedBlock> blocks = List.of(
        new TrackedBlock(0, 0, 0, "air", "polished_blackstone"),
        new TrackedBlock(0, 1, 0, "air", "deepslate"),
        new TrackedBlock(0, 2, 0, "air", "crying_obsidian")
    );
    assertThrows(IllegalStateException.class,
        () -> HerobrineStructureService.placeTracked(blocks, access));
    assertEquals("air", world.get("0,0,0"), "first block must be rolled back");
    assertEquals("air", world.get("0,1,0"), "second block must be rolled back");
    assertEquals("air", world.get("0,2,0"), "failed block untouched");
  }

  @Test
  void placeTrackedWritesEveryBlockOnSuccess() {
    Map<String, String> world = new HashMap<>();
    HerobrineStructureService.BlockDataAccess access = new HerobrineStructureService.BlockDataAccess() {
      @Override
      public String read(int x, int y, int z) {
        return world.getOrDefault(x + "," + y + "," + z, "air");
      }

      @Override
      public void write(int x, int y, int z, String blockData) {
        world.put(x + "," + y + "," + z, blockData);
      }
    };
    List<TrackedBlock> blocks = List.of(
        new TrackedBlock(5, 60, 5, "air", "deepslate"),
        new TrackedBlock(5, 61, 5, "short_grass", "smooth_basalt")
    );
    HerobrineStructureService.placeTracked(blocks, access);
    assertEquals("deepslate", world.get("5,60,5"));
    assertEquals("smooth_basalt", world.get("5,61,5"));
  }

  @Test
  void safeRestoreOnlyTouchesBlocksStillMatchingPlacedData() {
    assertTrue(HerobrineStructureService.shouldRestoreBlock("deepslate", "deepslate", false));
    assertFalse(HerobrineStructureService.shouldRestoreBlock("player_placed_chest", "deepslate", false),
        "player-modified block must be skipped in safe mode");
    assertFalse(HerobrineStructureService.shouldRestoreBlock(null, "deepslate", false));
    assertTrue(HerobrineStructureService.shouldRestoreBlock("player_placed_chest", "deepslate", true),
        "force mode restores unconditionally");
  }

  @Test
  void naturalTerrainAllowsWildernessGroundOnly() {
    assertTrue(HerobrineStructureService.naturalTerrain(Material.GRASS_BLOCK));
    assertTrue(HerobrineStructureService.naturalTerrain(Material.STONE));
    assertTrue(HerobrineStructureService.naturalTerrain(Material.SAND));
    assertFalse(HerobrineStructureService.naturalTerrain(Material.OAK_PLANKS));
    assertFalse(HerobrineStructureService.naturalTerrain(Material.STONE_BRICKS));
    assertFalse(HerobrineStructureService.naturalTerrain(Material.CHEST));
    assertFalse(HerobrineStructureService.naturalTerrain(null));
  }
}
