package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.config.RealCoreConfig;
import java.util.List;
import java.util.UUID;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class VaultDeltaShadowServiceTest {
  @Test
  void guardRequiresExplicitEnablementAndAllowlist() throws InvalidConfigurationException {
    assertEquals("economy.enabled is false",
        VaultDeltaShadowService.guardReason(config("smp-1", "smp", true, false, true, List.of("smp-1"))));
    assertEquals("economy.vaultDeltaShadowEnabled is false",
        VaultDeltaShadowService.guardReason(config("smp-1", "smp", true, true, false, List.of("smp-1"))));
    assertEquals("server.id is not in economy.vaultDeltaShadowBackendAllowlist",
        VaultDeltaShadowService.guardReason(config("factions-1", "factions", true, true, true, List.of("smp-1"))));
    assertEquals("",
        VaultDeltaShadowService.guardReason(config("smp-1", "smp", true, true, true, List.of("smp-1"))));
  }

  @Test
  void guardBlocksAnarchyEvenWhenExplicitlyAllowlisted() throws InvalidConfigurationException {
    String reason = VaultDeltaShadowService.guardReason(
        config("anarchy-1", "anarchy", true, true, true, List.of("anarchy-1")));

    assertEquals("Anarchy is blocked from economy shadow observation", reason);
  }

  @Test
  void guardRequiresEconomyModule() throws InvalidConfigurationException {
    String reason = VaultDeltaShadowService.guardReason(
        config("smp-1", "smp", false, true, true, List.of("smp-1")));

    assertEquals("modules.economy is false", reason);
  }

  @Test
  void limitsOnlinePlayerSamples() {
    List<VaultDeltaShadowService.PlayerSample> samples = List.of(
        sample(1),
        sample(2),
        sample(3)
    );

    assertEquals(2, VaultDeltaShadowService.limitSamples(samples, 2).size());
    assertEquals(samples, VaultDeltaShadowService.limitSamples(samples, 5));
  }

  @Test
  void deltaCalculationAndThresholdAreStable() {
    assertEquals(2500, VaultDeltaShadowService.deltaMinor(12_500, 10_000));
    assertEquals(-2500, VaultDeltaShadowService.deltaMinor(10_000, 12_500));
    assertFalse(VaultDeltaShadowService.shouldLogDelta(99, 100));
    assertTrue(VaultDeltaShadowService.shouldLogDelta(100, 100));
    assertTrue(VaultDeltaShadowService.shouldLogDelta(-100, 100));
  }

  @Test
  void classifiesDeltasByConfiguredThresholds() {
    assertEquals(VaultDeltaShadowService.DeltaSeverity.MATCH,
        VaultDeltaShadowService.classifyDelta(0, 5_000, 50_000));
    assertEquals(VaultDeltaShadowService.DeltaSeverity.SMALL,
        VaultDeltaShadowService.classifyDelta(4_999, 5_000, 50_000));
    assertEquals(VaultDeltaShadowService.DeltaSeverity.WARNING,
        VaultDeltaShadowService.classifyDelta(5_000, 5_000, 50_000));
    assertEquals(VaultDeltaShadowService.DeltaSeverity.SEVERE,
        VaultDeltaShadowService.classifyDelta(-50_000, 5_000, 50_000));
  }

  @Test
  void ignoresTinyConfiguredNoiseOnly() {
    assertTrue(VaultDeltaShadowService.ignoredNoise(-1, 1, true));
    assertFalse(VaultDeltaShadowService.ignoredNoise(-1, 1, false));
    assertTrue(VaultDeltaShadowService.ignoredNoise(99, 100, false));
    assertFalse(VaultDeltaShadowService.ignoredNoise(100, 100, false));
  }

  @Test
  void estimatesSyncHealthFromAggregateCounts() {
    assertEquals("unknown", VaultDeltaShadowService.estimatedSyncHealth(0, 0, 0));
    assertEquals("healthy", VaultDeltaShadowService.estimatedSyncHealth(10, 0, 0));
    assertEquals("watch", VaultDeltaShadowService.estimatedSyncHealth(10, 0, 1));
    assertEquals("needs_review", VaultDeltaShadowService.estimatedSyncHealth(10, 1, 0));
  }

  private static VaultDeltaShadowService.PlayerSample sample(int index) {
    return new VaultDeltaShadowService.PlayerSample(
        UUID.fromString("00000000-0000-0000-0000-%012d".formatted(index)),
        "Player" + index
    );
  }

  private static RealCoreConfig config(String serverId, String serverGroup, boolean moduleEnabled,
                                       boolean economyEnabled, boolean shadowEnabled, List<String> allowlist)
      throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    String allowlistYaml = allowlist.stream()
        .map(value -> "    - " + value)
        .reduce("", (left, right) -> left + right + "\n");
    yaml.loadFromString("""
        baseUrl: "https://realfiction.test"
        server:
          id: "%s"
          group: "%s"
          displayName: "Test"
        hmacSecret: "test-secret"
        modules:
          economy: %s
        economy:
          enabled: %s
          vaultDeltaShadowEnabled: %s
          vaultDeltaShadowBackendAllowlist:
        %s
        """.formatted(serverId, serverGroup, moduleEnabled, economyEnabled, shadowEnabled, allowlistYaml));
    return RealCoreConfig.from(yaml);
  }
}
