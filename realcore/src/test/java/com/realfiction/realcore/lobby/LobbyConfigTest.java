package com.realfiction.realcore.lobby;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class LobbyConfigTest {
  @Test
  void emptyConfigProducesSafeDefaults() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    LobbyConfig config = LobbyConfig.from(yaml);

    assertTrue(config.enabled());
    assertTrue(config.worlds().contains("Void_Spawn"));
    assertTrue(config.isLobbyWorld("Void_Spawn"));
    assertFalse(config.isLobbyWorld("nether"));

    // All protections default on.
    LobbyConfig.Protection protection = config.protection();
    assertTrue(protection.hunger());
    assertTrue(protection.pvp());
    assertTrue(protection.voidDamage());
    assertTrue(protection.weather());

    // Join defaults.
    assertTrue(config.join().setAdventure());
    assertTrue(config.join().giveItems());
    assertFalse(config.join().clearInventory());

    // Flight + scoreboard defaults.
    assertTrue(config.flight().enabled());
    assertEquals("realfiction.lobby.flight", config.flight().permission());
    assertTrue(config.doubleJump().enabled());
    assertEquals(0.85D, config.doubleJump().upwardVelocity());
    assertEquals(1.15D, config.doubleJump().forwardVelocity());
    assertEquals(8L, config.doubleJump().resetDelayTicks());
    assertTrue(config.walkSpeed().enabled());
    assertEquals(0.26F, config.walkSpeed().speed());
    assertEquals("Anarchy", config.resolveProxyServer("RealAnarchy"));
    assertTrue(config.scoreboard().enabled());
    assertEquals("&a&lRealFiction", config.scoreboard().title());
    assertEquals(9, config.scoreboard().lines().size());
    assertEquals(20L, config.scoreboard().refreshTicks());

    // Three default lobby items in the expected hotbar slots.
    assertEquals(3, config.items().size());
  }

  @Test
  void lobbyItemSlotMapsToZeroBasedHotbarIndex() {
    LobbyConfig.LobbyItem gameMenu = item(1);
    LobbyConfig.LobbyItem selector = item(3);
    LobbyConfig.LobbyItem visibility = item(9);

    assertEquals(0, gameMenu.hotbarIndex());
    assertEquals(2, selector.hotbarIndex());
    assertEquals(8, visibility.hotbarIndex());
    // Clamping.
    assertEquals(0, item(0).hotbarIndex());
    assertEquals(8, item(99).hotbarIndex());
  }

  @Test
  void honorsCustomOverrides() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        lobby:
          enabled: true
          worlds:
            - Hub
            - Spawn
          playerCommands: false
        protection:
          pvp: false
          weather: false
        join:
          setAdventure: false
          firework: true
        lobbyFlight:
          enabled: false
        doubleJump:
          enabled: false
          upwardVelocity: 1.4
          forwardVelocity: 1.8
          resetDelayTicks: 14
        walkSpeed:
          enabled: false
          speed: 0.3
        proxy:
          serverAliases:
            OldHub: Lobby1
        scoreboard:
          enabled: false
          refreshTicks: 40
        """);

    LobbyConfig config = LobbyConfig.from(yaml);

    assertTrue(config.isLobbyWorld("Hub"));
    assertTrue(config.isLobbyWorld("Spawn"));
    assertFalse(config.isLobbyWorld("Void_Spawn"));
    assertFalse(config.playerCommands());
    assertFalse(config.protection().pvp());
    assertFalse(config.protection().weather());
    assertTrue(config.protection().hunger());
    assertFalse(config.join().setAdventure());
    assertTrue(config.join().firework());
    assertFalse(config.flight().enabled());
    assertFalse(config.doubleJump().enabled());
    assertEquals(1.4D, config.doubleJump().upwardVelocity());
    assertEquals(1.8D, config.doubleJump().forwardVelocity());
    assertEquals(14L, config.doubleJump().resetDelayTicks());
    assertFalse(config.walkSpeed().enabled());
    assertEquals(0.3F, config.walkSpeed().speed());
    assertEquals("Lobby1", config.resolveProxyServer("OldHub"));
    assertEquals("SMP", config.resolveProxyServer("SMP"));
    assertFalse(config.scoreboard().enabled());
    assertEquals(40L, config.scoreboard().refreshTicks());
  }

  private static LobbyConfig.LobbyItem item(int slot) {
    return new LobbyConfig.LobbyItem(
        "test", slot, "MENU", "game-menu", "STONE", "name", List.of(), false,
        null, null, null, null, 0);
  }
}
