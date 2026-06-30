package com.realfiction.realcore.halloween;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.UUID;
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
        "resolved:Herobrine"
    );

    String summary = status.summary();

    assertTrue(summary.contains("requestedAppearance=packet_npc"));
    assertTrue(summary.contains("activeAppearance=packet_npc"));
    assertTrue(summary.contains("protocolLibDetected=true"));
    assertTrue(summary.contains("protocolLibSupported=true"));
    assertTrue(summary.contains("activePacketSessions=1"));
    assertTrue(summary.contains("fallbackReason=none"));
    assertTrue(summary.contains("skin=resolved:Herobrine"));
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
