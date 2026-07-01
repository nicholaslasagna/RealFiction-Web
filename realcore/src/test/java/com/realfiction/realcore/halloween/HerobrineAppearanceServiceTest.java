package com.realfiction.realcore.halloween;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class HerobrineAppearanceServiceTest {
  @Test
  void parsesPacketAutoAndArmorStandModes() throws InvalidConfigurationException {
    assertEquals("packet_npc", parseMode("packet_npc"));
    assertEquals("auto", parseMode("auto"));
    assertEquals("armor_stand", parseMode("armor_stand"));
    assertEquals("armor_stand", parseMode("bad-value"));
  }

  @Test
  void packetModeFallsBackWhenProtocolLibMissing() {
    HerobrineAppearanceConfig config = new HerobrineAppearanceConfig("packet_npc", true, "Herobrine", 20);

    HerobrineAppearanceService.Selection selection = HerobrineAppearanceService.select(config, false, "ProtocolLib not detected");

    assertEquals(HerobrineAppearanceService.Backend.ARMOR_STAND, selection.backend());
    assertEquals("ProtocolLib not detected", selection.reason());
  }

  @Test
  void packetModeSkipsWhenFallbackDisabled() {
    HerobrineAppearanceConfig config = new HerobrineAppearanceConfig("packet_npc", false, "Herobrine", 20);

    HerobrineAppearanceService.Selection selection = HerobrineAppearanceService.select(config, false, "unsupported");

    assertEquals(HerobrineAppearanceService.Backend.SKIP, selection.backend());
    assertEquals("unsupported", selection.reason());
  }

  @Test
  void autoUsesPacketWhenSupportedAndFallbackOtherwise() {
    HerobrineAppearanceConfig config = new HerobrineAppearanceConfig("auto", true, "Herobrine", 20);

    assertEquals(HerobrineAppearanceService.Backend.PACKET_NPC,
        HerobrineAppearanceService.select(config, true, "").backend());
    assertEquals(HerobrineAppearanceService.Backend.ARMOR_STAND,
        HerobrineAppearanceService.select(config, false, "missing").backend());
  }

  @Test
  void armorStandModeNeverUsesPacketBackend() {
    HerobrineAppearanceConfig config = new HerobrineAppearanceConfig("armor_stand", true, "Herobrine", 20);

    HerobrineAppearanceService.Selection selection = HerobrineAppearanceService.select(config, true, "");

    assertEquals(HerobrineAppearanceService.Backend.ARMOR_STAND, selection.backend());
    assertEquals("armor_stand requested", selection.reason());
  }

  @Test
  void packetSessionLifecycleIsIdempotentAndGenerationGuarded() {
    PacketNpcSession session = new PacketNpcSession(
        UUID.randomUUID(),
        UUID.randomUUID(),
        UUID.randomUUID(),
        12345,
        7L,
        11L,
        "rfhbtest",
        "Herobrine",
        null
    );

    assertTrue(session.active());
    assertTrue(session.accepts(7L, 11L));
    assertFalse(session.accepts(8L, 11L));
    assertFalse(session.tabListed());
    session.markTabListed();
    assertTrue(session.tabListed());
    assertTrue(session.clearTabListed());
    assertFalse(session.clearTabListed());
    assertTrue(session.deactivate());
    assertFalse(session.deactivate());
    assertFalse(session.accepts(7L, 11L));
  }

  @Test
  void statusSummaryExposesRequiredFields() {
    HerobrineAppearanceStatus status = new HerobrineAppearanceStatus(
        "packet_npc",
        "packet_npc",
        true,
        true,
        "",
        1,
        "resolved:Herobrine",
        "rel_entity_move_look; ENTITY_TELEPORT missing getDoubles/getVectors coordinates"
    );

    String summary = status.summary();

    assertTrue(summary.contains("requestedAppearance=packet_npc"));
    assertTrue(summary.contains("activeAppearance=packet_npc"));
    assertTrue(summary.contains("protocolLibDetected=true"));
    assertTrue(summary.contains("protocolLibSupported=true"));
    assertTrue(summary.contains("activePacketSessions=1"));
    assertTrue(summary.contains("fallbackReason=none"));
    assertTrue(summary.contains("skin=resolved:Herobrine"));
    assertTrue(summary.contains("packetMovement=rel_entity_move_look"));
  }

  @Test
  void entityTeleportDoubleCoordinatesUseTeleportMovement() {
    ProtocolLibHerobrinePackets.MovementPlan plan = ProtocolLibHerobrinePackets.chooseMovementPlan(3, 0, 0, 0);

    assertEquals(ProtocolLibHerobrinePackets.MovementMode.ENTITY_TELEPORT_DOUBLES, plan.mode());
    assertEquals("entity_teleport_doubles", plan.status());
  }

  @Test
  void entityTeleportVectorCoordinatesUseTeleportMovement() {
    ProtocolLibHerobrinePackets.MovementPlan plan = ProtocolLibHerobrinePackets.chooseMovementPlan(0, 1, 0, 0);

    assertEquals(ProtocolLibHerobrinePackets.MovementMode.ENTITY_TELEPORT_VECTOR, plan.mode());
    assertEquals("entity_teleport_vector", plan.status());
  }

  @Test
  void missingEntityTeleportCoordinatesFallsBackToRelativeMoveLook() {
    ProtocolLibHerobrinePackets.MovementPlan plan = ProtocolLibHerobrinePackets.chooseMovementPlan(0, 0, 3, 2);

    assertEquals(ProtocolLibHerobrinePackets.MovementMode.REL_ENTITY_MOVE_LOOK, plan.mode());
    assertTrue(plan.status().contains("rel_entity_move_look"));
    assertTrue(plan.status().contains("ENTITY_TELEPORT missing getDoubles/getVectors coordinates"));
  }

  @Test
  void missingTeleportAndRelativeMovementKeepsPacketBackendRotationOnly() {
    ProtocolLibHerobrinePackets.MovementPlan plan = ProtocolLibHerobrinePackets.chooseMovementPlan(0, 0, 0, 0);

    assertEquals(ProtocolLibHerobrinePackets.MovementMode.ROTATION_ONLY, plan.mode());
    assertTrue(plan.status().contains("ENTITY_TELEPORT missing getDoubles/getVectors coordinates"));
    assertTrue(plan.status().contains("REL_ENTITY_MOVE_LOOK missing getShorts/getBytes movement"));
  }

  @Test
  void movementProbeStatusIncludesExactOptionalPacketAccessorFailure() {
    ProtocolLibHerobrinePackets.MovementPlan plan = ProtocolLibHerobrinePackets.chooseMovementPlan(
        0,
        0,
        0,
        0,
        "ENTITY_TELEPORT create/read failed: coordinates unavailable",
        "REL_ENTITY_MOVE_LOOK create/read failed: getShorts unavailable"
    );

    assertEquals(ProtocolLibHerobrinePackets.MovementMode.ROTATION_ONLY, plan.mode());
    assertTrue(plan.status().contains("ENTITY_TELEPORT create/read failed: coordinates unavailable"));
    assertTrue(plan.status().contains("REL_ENTITY_MOVE_LOOK create/read failed: getShorts unavailable"));
  }

  @Test
  void packetProbeCheckSummariesExposeExactFailureReason() {
    ProtocolLibHerobrinePackets.ProbeCheck ok =
        new ProtocolLibHerobrinePackets.ProbeCheck("spawn packet", true, "");
    ProtocolLibHerobrinePackets.ProbeCheck fail =
        new ProtocolLibHerobrinePackets.ProbeCheck("destroy packet", false, "ENTITY_DESTROY getIntLists unavailable");

    assertEquals("spawn packet: ok", ok.summary());
    assertTrue(fail.summary().contains("destroy packet: fail ENTITY_DESTROY getIntLists unavailable"));
  }

  @Test
  void packetProbeReportCarriesMovementAndFallbackReasonForCommandOutput() {
    ProtocolLibHerobrinePackets.ProbeReport report = new ProtocolLibHerobrinePackets.ProbeReport(
        true,
        false,
        java.util.List.of(new ProtocolLibHerobrinePackets.ProbeCheck(
            "spawn packet",
            false,
            "SPAWN_ENTITY getDoubles coordinates unavailable")),
        "rotation_only",
        "spawn packet SPAWN_ENTITY getDoubles coordinates unavailable"
    );

    assertTrue(report.detected());
    assertFalse(report.supported());
    assertEquals("rotation_only", report.movementMode());
    assertTrue(report.reason().contains("SPAWN_ENTITY getDoubles coordinates unavailable"));
  }

  @Test
  void packetProbeFailsWhenPlayerInfoAddUpdateConstructionFails() {
    ProtocolLibHerobrinePackets.ProbeReport report = ProtocolLibHerobrinePackets.buildProbeReport(
        true,
        List.of(
            new ProtocolLibHerobrinePackets.ProbeCheck(
                "player info add/update",
                false,
                "PLAYER_INFO_UPDATE native entry payload unsupported: entries contain ProtocolLib PlayerInfoData wrappers"),
            new ProtocolLibHerobrinePackets.ProbeCheck("player info remove", true, ""),
            new ProtocolLibHerobrinePackets.ProbeCheck("spawn packet", true, "")),
        new ProtocolLibHerobrinePackets.MovementPlan(
            ProtocolLibHerobrinePackets.MovementMode.REL_ENTITY_MOVE_LOOK,
            "rel_entity_move_look")
    );

    assertFalse(report.supported());
    assertEquals("rel_entity_move_look", report.movementMode());
    assertTrue(report.reason().startsWith("PLAYER_INFO_UPDATE native entry payload unsupported"));
    assertTrue(report.reason().contains("PlayerInfoData wrappers"));
  }

  @Test
  void packetProbeOutputIncludesPlayerInfoAddUpdateAndRemoveResults() {
    ProtocolLibHerobrinePackets.ProbeReport report = ProtocolLibHerobrinePackets.buildProbeReport(
        true,
        List.of(
            new ProtocolLibHerobrinePackets.ProbeCheck("player info add/update", true, ""),
            new ProtocolLibHerobrinePackets.ProbeCheck("player info remove", true, "")),
        new ProtocolLibHerobrinePackets.MovementPlan(
            ProtocolLibHerobrinePackets.MovementMode.REL_ENTITY_MOVE_LOOK,
            "rel_entity_move_look")
    );

    assertTrue(report.supported());
    assertEquals("player info add/update: ok", report.checks().get(0).summary());
    assertEquals("player info remove: ok", report.checks().get(1).summary());
  }

  @Test
  void playerInfoEntryInspectionRejectsProtocolLibWrappers() {
    ProtocolLibHerobrinePackets.PlayerInfoPayloadInspection inspection =
        ProtocolLibHerobrinePackets.inspectPlayerInfoEntryClassNames(List.of(
            "com.comphenix.protocol.wrappers.PlayerInfoData"));

    assertFalse(inspection.nativeCompatible());
    assertTrue(inspection.reason().contains("PLAYER_INFO_UPDATE native entry payload unsupported"));
    assertTrue(inspection.reason().contains("PlayerInfoData wrappers"));
  }

  @Test
  void playerInfoEntryInspectionAcceptsNativeEntryShape() {
    ProtocolLibHerobrinePackets.PlayerInfoPayloadInspection inspection =
        ProtocolLibHerobrinePackets.inspectPlayerInfoEntryClassNames(List.of(
            "net.minecraft.network.protocol.game.ClientboundPlayerInfoUpdatePacket$Entry"));

    assertTrue(inspection.nativeCompatible());
    assertEquals("native entries ok", inspection.reason());
  }

  @Test
  void packetModeFallsBackForUnsafeNativePlayerInfoPayload() {
    HerobrineAppearanceConfig config = new HerobrineAppearanceConfig("packet_npc", true, "Herobrine", 20);

    HerobrineAppearanceService.Selection selection = HerobrineAppearanceService.select(
        config,
        false,
        "PLAYER_INFO_UPDATE native entry payload unsupported");

    assertEquals(HerobrineAppearanceService.Backend.ARMOR_STAND, selection.backend());
    assertEquals("PLAYER_INFO_UPDATE native entry payload unsupported", selection.reason());
  }

  @Test
  void forcedPacketModeSkipsForUnsafeNativePlayerInfoPayloadWhenFallbackDisabled() {
    HerobrineAppearanceConfig config = new HerobrineAppearanceConfig("packet_npc", false, "Herobrine", 20);

    HerobrineAppearanceService.Selection selection = HerobrineAppearanceService.select(
        config,
        false,
        "PLAYER_INFO_UPDATE native entry payload unsupported");

    assertEquals(HerobrineAppearanceService.Backend.SKIP, selection.backend());
    assertEquals("PLAYER_INFO_UPDATE native entry payload unsupported", selection.reason());
  }

  @Test
  void productionSourceHasNoDropChanceCalls() throws IOException {
    Path sourceRoot = Path.of("src/main/java/com/realfiction/realcore");
    try (Stream<Path> files = Files.walk(sourceRoot)) {
      List<Path> offenders = files
          .filter(path -> path.toString().endsWith(".java"))
          .filter(path -> {
            try {
              return Files.readString(path).contains("DropChance");
            } catch (IOException error) {
              throw new IllegalStateException(error);
            }
          })
          .toList();

      assertTrue(offenders.isEmpty(), "DropChance references found: " + offenders);
    }
  }

  @Test
  void adminCleanupResultFormatsPacketAndFallbackCounts() {
    HerobrineStalkerService.AdminCleanupResult result =
        new HerobrineStalkerService.AdminCleanupResult(2, 1, 2, 0);

    assertTrue(result.lines().contains("cleanedSightings=2"));
    assertTrue(result.lines().contains("cleanedPacketSessions=1"));
    assertTrue(result.lines().contains("cleanedFallbackEntities=2"));
    assertTrue(result.lines().contains("activePacketSessions=0"));
  }

  private static String parseMode(String mode) throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        appearance:
          mode: "%s"
        """.formatted(mode));
    return HerobrineAppearanceConfig.from(yaml.getConfigurationSection("appearance"), "Herobrine").mode();
  }
}
