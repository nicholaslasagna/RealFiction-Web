package com.realfiction.realcore.halloween;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.halloween.HerobrineStructureRegistry.TrackedBlock;
import com.realfiction.realcore.halloween.HerobrineStructureRegistry.TrackedStructure;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The registry is the safety backbone: every placed block must survive a save/load
 * roundtrip byte-for-byte so restore always has the original block data.
 */
final class HerobrineStructureRegistryTest {
  @TempDir
  Path tempDir;

  private static TrackedStructure sample(UUID id, String world, Long restoredAt) {
    return new TrackedStructure(
        id,
        world,
        "void_monolith",
        100, 64, -200,
        List.of(
            new TrackedBlock(100, 64, -200, "minecraft:air", "minecraft:polished_blackstone"),
            new TrackedBlock(100, 65, -200, "minecraft:short_grass", "minecraft:deepslate")
        ),
        "herobrine_omen",
        1_700_000_000_000L,
        restoredAt
    );
  }

  @Test
  void saveLoadRoundtripPreservesEverything() throws IOException {
    Path file = tempDir.resolve("structures.json");
    HerobrineStructureRegistry registry = new HerobrineStructureRegistry(file, null);
    registry.load();
    UUID id = UUID.randomUUID();
    registry.addAndSave(sample(id, "Survival", null));
    assertTrue(Files.exists(file));
    assertFalse(Files.exists(file.resolveSibling("structures.json.tmp")), "temp file must be moved away");

    HerobrineStructureRegistry reloaded = new HerobrineStructureRegistry(file, null);
    reloaded.load();
    TrackedStructure structure = reloaded.get(id).orElseThrow();
    assertEquals("Survival", structure.world());
    assertEquals("void_monolith", structure.type());
    assertEquals(2, structure.blocks().size());
    assertEquals("minecraft:short_grass", structure.blocks().get(1).originalData());
    assertEquals("minecraft:deepslate", structure.blocks().get(1).placedData());
    assertEquals("herobrine_omen", structure.reason());
    assertFalse(structure.restored());
  }

  @Test
  void markRestoredPersistsAcrossReload() throws IOException {
    Path file = tempDir.resolve("structures.json");
    HerobrineStructureRegistry registry = new HerobrineStructureRegistry(file, null);
    registry.load();
    UUID id = UUID.randomUUID();
    registry.addAndSave(sample(id, "Survival", null));
    registry.markRestored(id, 1_700_000_500_000L);

    HerobrineStructureRegistry reloaded = new HerobrineStructureRegistry(file, null);
    reloaded.load();
    assertTrue(reloaded.get(id).orElseThrow().restored());
    assertEquals(1_700_000_500_000L, reloaded.get(id).orElseThrow().restoredAtMillis());
  }

  @Test
  void activeCountIsPerWorldAndExcludesRestored() throws IOException {
    Path file = tempDir.resolve("structures.json");
    HerobrineStructureRegistry registry = new HerobrineStructureRegistry(file, null);
    registry.load();
    registry.addAndSave(sample(UUID.randomUUID(), "Survival", null));
    registry.addAndSave(sample(UUID.randomUUID(), "Survival", 1L));
    registry.addAndSave(sample(UUID.randomUUID(), "OtherWorld", null));
    assertEquals(1, registry.activeCount("Survival"));
    assertEquals(1, registry.activeCount("OtherWorld"));
    assertEquals(0, registry.activeCount("Nether"));
    assertEquals(2, registry.activeCountTotal());
  }

  @Test
  void cleanupRemovesOnlyRestoredEntries() throws IOException {
    Path file = tempDir.resolve("structures.json");
    HerobrineStructureRegistry registry = new HerobrineStructureRegistry(file, null);
    registry.load();
    UUID active = UUID.randomUUID();
    registry.addAndSave(sample(active, "Survival", null));
    registry.addAndSave(sample(UUID.randomUUID(), "Survival", 5L));
    assertEquals(1, registry.cleanupRestored());
    assertTrue(registry.get(active).isPresent());
    assertEquals(1, registry.all().size());
  }

  @Test
  void loadOfEmptyOrMissingFileYieldsEmptyRegistry() {
    HerobrineStructureRegistry registry = new HerobrineStructureRegistry(tempDir.resolve("missing.json"), null);
    registry.load();
    assertEquals(0, registry.all().size());
  }
}
