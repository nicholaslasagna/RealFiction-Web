package com.realfiction.realcore.lobby.seasonal;

import com.realfiction.realcore.lobby.LobbyConfig;
import com.realfiction.realcore.lobby.LobbyManager;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;

/** Resolves where seasonal lobby effects anchor (spawn-first). */
public final class SeasonalShowOrigin {
  private final String source;
  private final Location location;

  private SeasonalShowOrigin(String source, Location location) {
    this.source = source;
    this.location = location;
  }

  public String source() {
    return source;
  }

  public Location location() {
    return location;
  }

  public boolean valid() {
    return location != null && location.getWorld() != null;
  }

  public String summary() {
    if (!valid()) {
      return "unresolved (" + source + ")";
    }
    Location loc = location;
    return source + " @ " + loc.getWorld().getName()
        + " (" + format(loc.getX()) + ", " + format(loc.getY()) + ", " + format(loc.getZ()) + ")";
  }

  public static SeasonalShowOrigin resolve(LobbyManager lobby) {
    if (lobby == null) {
      return unresolved("lobby-missing");
    }
    LobbyConfig config = lobby.config();
    if (!config.enabled()) {
      return unresolved("lobby-disabled");
    }

    LobbyConfig.SpawnPoint spawn = config.spawn();
    World spawnWorld = Bukkit.getWorld(spawn.world());
    if (spawnWorld != null) {
      if (spawn.present()) {
        return new SeasonalShowOrigin(
            "lobby.spawn",
            new Location(spawnWorld, spawn.x(), spawn.y(), spawn.z(), spawn.yaw(), spawn.pitch())
        );
      }
      return new SeasonalShowOrigin("world.spawn:" + spawn.world(), spawnWorld.getSpawnLocation().clone());
    }

    for (String worldName : config.worlds()) {
      World world = Bukkit.getWorld(worldName);
      if (world != null) {
        return new SeasonalShowOrigin("world.spawn:" + worldName, world.getSpawnLocation().clone());
      }
    }

    for (Player player : Bukkit.getOnlinePlayers()) {
      if (player.getWorld() != null && config.isLobbyWorld(player.getWorld().getName())) {
        return new SeasonalShowOrigin("player:" + player.getName(), player.getLocation().clone());
      }
    }

    return unresolved("no-origin (no loaded lobby world or player)");
  }

  private static SeasonalShowOrigin unresolved(String source) {
    return new SeasonalShowOrigin(source, null);
  }

  private static String format(double value) {
    return String.format(java.util.Locale.ROOT, "%.1f", value);
  }
}
