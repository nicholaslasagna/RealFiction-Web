package com.realfiction.realcore.halloween;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

/**
 * Smoke test for the SHIPPED resource config.yml. Merge-conflict resolutions have
 * mangled this file before (duplicate windowStalk.maxCandidateChecks keys); this pins
 * the safety-relevant Halloween values so a bad merge fails the build instead of
 * shipping stale or dangerous defaults.
 */
final class HerobrineResourceConfigTest {
  private static HerobrineStalkerConfig loadShippedStalkerConfig() throws Exception {
    try (InputStream stream = HerobrineResourceConfigTest.class.getResourceAsStream("/config.yml")) {
      assertNotNull(stream, "resource config.yml missing from classpath");
      YamlConfiguration yaml = YamlConfiguration.loadConfiguration(
          new InputStreamReader(stream, StandardCharsets.UTF_8));
      HalloweenConfig halloween = HalloweenConfig.from(yaml.getConfigurationSection("halloween"));
      return halloween.herobrineStalker();
    }
  }

  @Test
  void shippedConfigHasPolishedWindowStalkValues() throws Exception {
    HerobrineWindowStalkConfig window = loadShippedStalkerConfig().windowStalk();
    assertEquals(8, window.minOutsideDistance());
    assertEquals(24, window.maxOutsideDistance());
    assertEquals(48, window.maxCandidateChecks());
  }

  @Test
  void shippedConfigKeepsPersistentStructuresFullyDisabled() throws Exception {
    HerobrineDistantOmenStructureConfig omen = loadShippedStalkerConfig().distantOmenStructure();
    assertTrue(omen.particlesOnly());
    assertFalse(omen.packetFakeBlocks());
    assertFalse(omen.persistentBlocks());
    assertFalse(omen.persistent().enabled());
    assertFalse(omen.persistentPlacementConfigured());
    assertTrue(omen.omenPathAllowed());
  }

  @Test
  void shippedConfigUsesHerobrineeeSkinOwner() throws Exception {
    HerobrineStalkerConfig stalker = loadShippedStalkerConfig();
    assertEquals("Herobrineee", stalker.appearance().skinOwner());
    assertEquals("Herobrineee", stalker.headOwner());
  }

  @Test
  void shippedConfigHasNoDuplicateKeysInHalloweenSection() throws Exception {
    try (InputStream stream = HerobrineResourceConfigTest.class.getResourceAsStream("/config.yml")) {
      assertNotNull(stream);
      String raw = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
      int halloweenStart = raw.indexOf("\nhalloween:");
      assertTrue(halloweenStart >= 0, "halloween section missing");
      String halloween = raw.substring(halloweenStart);
      // Duplicate-key canary for the exact past failure: each mapping key at a given
      // indent inside one block must appear once. Check the keys the merge damaged.
      String windowStalk = halloween.substring(
          halloween.indexOf("windowStalk:"),
          halloween.indexOf("distantOmenStructure:"));
      long candidateKeyCount = windowStalk.lines()
          .filter(line -> line.trim().startsWith("maxCandidateChecks:"))
          .count();
      assertEquals(1, candidateKeyCount, "windowStalk must define maxCandidateChecks exactly once");
    }
  }
}
