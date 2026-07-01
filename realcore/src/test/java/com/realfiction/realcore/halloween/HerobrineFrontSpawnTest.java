package com.realfiction.realcore.halloween;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.UUID;
import org.bukkit.util.Vector;
import org.junit.jupiter.api.Test;

/**
 * The packet-front admin test must place Herobrine 6-10 blocks ahead of the player's view
 * direction (flattened to the horizon), independent of random candidate logic, and its packet
 * sessions must expose an honest send trace.
 */
final class HerobrineFrontSpawnTest {
  @Test
  void frontOffsetsAreSixToTenBlocksAheadFlattened() {
    List<Vector> offsets = HerobrineStalkerService.frontOffsets(new Vector(0.0, -0.9, 0.4));
    assertEquals(3, offsets.size());
    assertEquals(8.0, offsets.get(0).length(), 1.0E-6);
    assertEquals(6.0, offsets.get(1).length(), 1.0E-6);
    assertEquals(10.0, offsets.get(2).length(), 1.0E-6);
    for (Vector offset : offsets) {
      assertEquals(0.0, offset.getY(), 1.0E-9, "front offsets must be flattened to the horizon");
      assertTrue(offset.getZ() > 0.0, "offset must follow the horizontal view direction");
    }
  }

  @Test
  void straightDownLookFallsBackToPositiveZ() {
    List<Vector> offsets = HerobrineStalkerService.frontOffsets(new Vector(0.0, -1.0, 0.0));
    assertEquals(8.0, offsets.get(0).getZ(), 1.0E-6);
    assertEquals(0.0, offsets.get(0).getX(), 1.0E-6);
  }

  @Test
  void nullDirectionFallsBackToPositiveZ() {
    List<Vector> offsets = HerobrineStalkerService.frontOffsets(null);
    assertEquals(8.0, offsets.get(0).getZ(), 1.0E-6);
  }

  @Test
  void packetSessionTraceReportsSendPhasesAndIdentity() {
    PacketNpcSession session = new PacketNpcSession(
        UUID.randomUUID(),
        UUID.randomUUID(),
        UUID.fromString("00000000-0000-0000-0000-00000000abcd"),
        1_450_000_123,
        1L,
        1L,
        "rfhbtest",
        "Herobrine",
        null
    );
    String before = session.traceSummary();
    assertTrue(before.contains("playerInfoAddSent=false"));
    assertTrue(before.contains("spawnPacketSent=false"));
    assertTrue(before.contains("fakeEntityId=1450000123"));
    assertTrue(before.contains("fakeProfileUuid=00000000-0000-0000-0000-00000000abcd"));
    assertTrue(before.contains("spawnEntityType=PLAYER"));

    session.markPlayerInfoAddSent();
    session.markSpawnPacketSent();
    session.markMetadataSent();
    session.markRotationSent();
    session.markTeamSent();
    session.markTabRemoveSent();
    session.markDestroySent();
    String after = session.traceSummary();
    assertTrue(after.contains("playerInfoAddSent=true"));
    assertTrue(after.contains("spawnPacketSent=true"));
    assertTrue(after.contains("metadataSent=true"));
    assertTrue(after.contains("rotationSent=true"));
    assertTrue(after.contains("scoreboardTeamSent=true"));
    assertTrue(after.contains("tabRemoveSent=true"));
    assertTrue(after.contains("destroySent=true"));
  }

  @Test
  void debugStareSightingSkipsVanishOnLook() {
    HerobrineSighting sighting = new HerobrineSighting(
        UUID.randomUUID(),
        UUID.randomUUID(),
        "Tester",
        (UUID) null,
        java.time.Instant.now(),
        java.time.Instant.now().plusSeconds(30),
        false,
        false,
        null
    );
    assertTrue(!sighting.debugStare());
    sighting.markDebugStare();
    assertTrue(sighting.debugStare());
  }

  @Test
  void renderConfidenceIsHonestAboutWhatServerCanProve() {
    assertTrue(ProtocolLibHerobrinePackets.renderConfidence(true, true, true).startsWith("high"));
    assertTrue(ProtocolLibHerobrinePackets.renderConfidence(true, true, false).startsWith("medium"));
    assertTrue(ProtocolLibHerobrinePackets.renderConfidence(true, false, true).startsWith("low"));
    assertTrue(ProtocolLibHerobrinePackets.renderConfidence(false, true, true).startsWith("low"));
    assertTrue(ProtocolLibHerobrinePackets.renderConfidence(true, true, true).contains("not directly verifiable"));
  }
}
