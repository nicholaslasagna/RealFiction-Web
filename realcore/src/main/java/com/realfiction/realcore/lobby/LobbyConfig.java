package com.realfiction.realcore.lobby;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.FileConfiguration;

/**
 * Parsed lobby configuration. Kept separate from the website {@code RealCoreConfig}
 * record so the linking/reward HMAC contract is never affected by lobby changes.
 */
public record LobbyConfig(
    boolean enabled,
    Set<String> worlds,
    SpawnPoint spawn,
    Protection protection,
    Join join,
    Flight flight,
    ScoreboardSettings scoreboard,
    List<LobbyItem> items,
    boolean playerCommands,
    List<LobbyEntry> lobbies
) {
  public boolean isLobbyWorld(String worldName) {
    return enabled && worldName != null && worlds.contains(worldName);
  }

  public record SpawnPoint(String world, double x, double y, double z, float yaw, float pitch, boolean present) {
  }

  public record Protection(
      boolean hunger,
      boolean pvp,
      boolean fire,
      boolean drowning,
      boolean voidDamage,
      boolean deathMessages,
      boolean mobSpawning,
      boolean itemDrop,
      boolean itemPickup,
      boolean blockBreak,
      boolean blockPlace,
      boolean blockInteract,
      boolean fireSpread,
      boolean leafDecay,
      boolean offhandSwap,
      boolean weather
  ) {
  }

  public record Join(
      boolean setAdventure,
      boolean sound,
      boolean speed,
      int speedAmplifier,
      boolean firework,
      boolean clearInventory,
      boolean clearEffects,
      boolean giveItems,
      String joinMessage,
      String quitMessage
  ) {
  }

  public record Flight(boolean enabled, String permission) {
  }

  public record ScoreboardSettings(boolean enabled, String title, List<String> lines, long refreshTicks) {
  }

  /** A lobby hotbar item. {@code type} is MENU or VISIBILITY. */
  public record LobbyItem(
      String id,
      int slot,
      String type,
      String menuId,
      String material,
      String name,
      List<String> lore,
      boolean glow,
      String onMaterial,
      String onName,
      String offMaterial,
      String offName,
      int cooldownSeconds
  ) {
    public boolean isVisibility() {
      return "VISIBILITY".equalsIgnoreCase(type);
    }

    public boolean isMenu() {
      return "MENU".equalsIgnoreCase(type);
    }

    /** Converts a 1-based config slot to a 0-based hotbar index (0-8). */
    public int hotbarIndex() {
      int index = slot - 1;
      if (index < 0) {
        index = 0;
      }
      if (index > 8) {
        index = 8;
      }
      return index;
    }
  }

  /** Scaffold for the lobby selector. {@code current} = this server. */
  public record LobbyEntry(String id, String displayName, String serverName, boolean current) {
  }

  public static LobbyConfig from(FileConfiguration config) {
    boolean enabled = config.getBoolean("lobby.enabled", true);

    Set<String> worlds = new LinkedHashSet<>(config.getStringList("lobby.worlds"));
    if (worlds.isEmpty()) {
      worlds.add("Void_Spawn");
    }

    String spawnWorld = config.getString("lobby.spawn.world", worlds.iterator().next());
    boolean spawnPresent = config.isSet("lobby.spawn.x") && config.isSet("lobby.spawn.y") && config.isSet("lobby.spawn.z");
    SpawnPoint spawn = new SpawnPoint(
        spawnWorld,
        config.getDouble("lobby.spawn.x", 0.5),
        config.getDouble("lobby.spawn.y", 100.0),
        config.getDouble("lobby.spawn.z", 0.5),
        (float) config.getDouble("lobby.spawn.yaw", 0.0),
        (float) config.getDouble("lobby.spawn.pitch", 0.0),
        spawnPresent
    );

    Protection protection = new Protection(
        config.getBoolean("protection.hunger", true),
        config.getBoolean("protection.pvp", true),
        config.getBoolean("protection.fire", true),
        config.getBoolean("protection.drowning", true),
        config.getBoolean("protection.voidDeath", true),
        config.getBoolean("protection.deathMessages", true),
        config.getBoolean("protection.mobSpawning", true),
        config.getBoolean("protection.itemDrop", true),
        config.getBoolean("protection.itemPickup", true),
        config.getBoolean("protection.blockBreak", true),
        config.getBoolean("protection.blockPlace", true),
        config.getBoolean("protection.blockInteract", true),
        config.getBoolean("protection.fireSpread", true),
        config.getBoolean("protection.leafDecay", true),
        config.getBoolean("protection.offhandSwap", true),
        config.getBoolean("protection.weather", true)
    );

    Join join = new Join(
        config.getBoolean("join.setAdventure", true),
        config.getBoolean("join.sound", true),
        config.getBoolean("join.speed", false),
        Math.max(0, config.getInt("join.speedAmplifier", 1)),
        config.getBoolean("join.firework", false),
        config.getBoolean("join.clearInventory", false),
        config.getBoolean("join.clearEffects", false),
        config.getBoolean("join.giveItems", true),
        config.getString("join.joinMessage", ""),
        config.getString("join.quitMessage", "")
    );

    Flight flight = new Flight(
        config.getBoolean("lobbyFlight.enabled", true),
        config.getString("lobbyFlight.permission", "realfiction.lobby.flight")
    );

    ScoreboardSettings scoreboard = new ScoreboardSettings(
        config.getBoolean("scoreboard.enabled", true),
        config.getString("scoreboard.title", "&a&lRealFiction"),
        scoreboardLines(config),
        Math.max(5L, config.getLong("scoreboard.refreshTicks", 20L))
    );

    List<LobbyItem> items = parseItems(config.getConfigurationSection("lobbyItems"));
    boolean playerCommands = config.getBoolean("lobby.playerCommands", true);
    List<LobbyEntry> lobbies = parseLobbies(config.getConfigurationSection("lobby.lobbies"));

    return new LobbyConfig(enabled, worlds, spawn, protection, join, flight, scoreboard, List.copyOf(items), playerCommands, lobbies);
  }

  private static List<String> scoreboardLines(FileConfiguration config) {
    List<String> lines = config.getStringList("scoreboard.lines");
    if (!lines.isEmpty()) {
      return List.copyOf(lines);
    }
    return List.of(
        "",
        " &6Welcome!",
        " &fUser: &7%player%",
        " &fOnline: &a%online%/%max_online%",
        "",
        "&7Java:",
        "&erealfiction.live",
        "&7Bedrock:",
        "&eplay.realfiction.live"
    );
  }

  private static List<LobbyItem> parseItems(ConfigurationSection section) {
    List<LobbyItem> items = new ArrayList<>();
    if (section == null) {
      return defaultItems();
    }
    for (String id : section.getKeys(false)) {
      ConfigurationSection item = section.getConfigurationSection(id);
      if (item == null) {
        continue;
      }
      String type = item.getString("type", "menu").toUpperCase(Locale.ROOT);
      int slot = item.getInt("slot", 1);
      items.add(new LobbyItem(
          id,
          slot,
          type,
          item.getString("menu", id),
          item.getString("material", "STONE"),
          item.getString("name", ""),
          item.getStringList("lore"),
          item.getBoolean("glow", false),
          item.getString("on.material", "LIME_DYE"),
          item.getString("on.name", "&fPlayers: &aVisible &7(Right Click)"),
          item.getString("off.material", "GRAY_DYE"),
          item.getString("off.name", "&fPlayers: &cHidden &7(Right Click)"),
          Math.max(0, item.getInt("cooldownSeconds", 3))
      ));
    }
    return items.isEmpty() ? defaultItems() : items;
  }

  private static List<LobbyItem> defaultItems() {
    return List.of(
        new LobbyItem("game-menu", 1, "MENU", "game-menu", "PLAYER_HEAD",
            "&aGame Menu &7(Right Click)", List.of(), true, null, null, null, null, 0),
        new LobbyItem("lobby-selector", 3, "MENU", "lobby-selector", "BOOK",
            "&aLobby Selector &7(Right Click)", List.of(), false, null, null, null, null, 0),
        new LobbyItem("player-visibility", 9, "VISIBILITY", null, "LIME_DYE",
            "", List.of(), false,
            "LIME_DYE", "&fPlayers: &aVisible &7(Right Click)",
            "GRAY_DYE", "&fPlayers: &cHidden &7(Right Click)", 3)
    );
  }

  private static List<LobbyEntry> parseLobbies(ConfigurationSection section) {
    List<LobbyEntry> lobbies = new ArrayList<>();
    if (section == null) {
      lobbies.add(new LobbyEntry("lobby-1", "&aLobby 1", "Lobby1", true));
      return lobbies;
    }
    for (String id : section.getKeys(false)) {
      ConfigurationSection entry = section.getConfigurationSection(id);
      if (entry == null) {
        continue;
      }
      lobbies.add(new LobbyEntry(
          id,
          entry.getString("displayName", id),
          entry.getString("server", id),
          entry.getBoolean("current", false)
      ));
    }
    if (lobbies.isEmpty()) {
      lobbies.add(new LobbyEntry("lobby-1", "&aLobby 1", "Lobby1", true));
    }
    return lobbies;
  }
}
