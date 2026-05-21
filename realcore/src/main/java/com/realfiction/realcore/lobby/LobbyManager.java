package com.realfiction.realcore.lobby;

import com.realfiction.realcore.menu.MenuRegistry;
import com.realfiction.realcore.menu.MenuService;
import com.realfiction.realcore.proxy.ProxyService;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scoreboard.ScoreboardService;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.FireworkEffect;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Firework;
import org.bukkit.entity.Player;
import org.bukkit.inventory.meta.FireworkMeta;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

/**
 * Central lobby orchestration: holds the live {@link LobbyConfig} and menu
 * registry and owns the lobby sub-services. Created once; {@link #reload} swaps
 * config without re-registering listeners.
 */
public final class LobbyManager {
  private final JavaPlugin plugin;
  private final RealCoreScheduler scheduler;

  private volatile LobbyConfig config;
  private volatile MenuRegistry menuRegistry;

  private final ProxyService proxyService;
  private final VisibilityService visibilityService;
  private final LobbyItemService lobbyItemService;
  private final LobbyFlightService flightService;
  private final MenuService menuService;
  private final ScoreboardService scoreboardService;
  private boolean started;

  public LobbyManager(JavaPlugin plugin, RealCoreScheduler scheduler, FileConfiguration initialConfig) {
    this.plugin = plugin;
    this.scheduler = scheduler;
    this.config = LobbyConfig.from(initialConfig);
    this.menuRegistry = MenuRegistry.from(menusSection(initialConfig), plugin.getLogger());
    this.proxyService = new ProxyService(plugin, scheduler);
    this.visibilityService = new VisibilityService(plugin, scheduler);
    this.lobbyItemService = new LobbyItemService(plugin, scheduler, visibilityService);
    this.flightService = new LobbyFlightService(scheduler);
    this.menuService = new MenuService(plugin, scheduler, proxyService, this::menuRegistry);
    this.scoreboardService = new ScoreboardService(plugin, scheduler, this::config);
  }

  public LobbyConfig config() {
    return config;
  }

  public MenuRegistry menuRegistry() {
    return menuRegistry;
  }

  public MenuService menuService() {
    return menuService;
  }

  public VisibilityService visibilityService() {
    return visibilityService;
  }

  public LobbyItemService lobbyItemService() {
    return lobbyItemService;
  }

  public LobbyFlightService flightService() {
    return flightService;
  }

  public ProxyService proxyService() {
    return proxyService;
  }

  public void start() {
    if (started) {
      return;
    }
    proxyService.register();
    if (config.enabled() && config.scoreboard().enabled()) {
      scoreboardService.start();
    }
    started = true;
  }

  public void reload(FileConfiguration newConfig) {
    this.config = LobbyConfig.from(newConfig);
    this.menuRegistry = MenuRegistry.from(menusSection(newConfig), plugin.getLogger());

    if (config.enabled() && config.scoreboard().enabled()) {
      scoreboardService.start();
    } else {
      scoreboardService.stop();
    }

    LobbyConfig current = config;
    for (Player player : Bukkit.getOnlinePlayers()) {
      String world = player.getWorld().getName();
      flightService.applyFor(player, world, current);
      if (current.enabled() && current.isLobbyWorld(world)) {
        lobbyItemService.give(player, current);
      }
    }
  }

  public void shutdown() {
    scoreboardService.stop();
    proxyService.unregister();
    started = false;
  }

  public void handleJoin(Player player) {
    LobbyConfig current = config;
    if (!current.enabled()) {
      return;
    }
    String world = player.getWorld().getName();
    boolean inLobby = current.isLobbyWorld(world);

    if (inLobby) {
      scheduler.runForPlayer(player, () -> applyJoinState(player, current));
      lobbyItemService.give(player, current);
      scoreboardService.refresh(player);
    }
    flightService.applyFor(player, world, current);
    visibilityService.onJoin(player);
  }

  private void applyJoinState(Player player, LobbyConfig current) {
    if (!player.isOnline()) {
      return;
    }
    LobbyConfig.Join join = current.join();
    if (join.clearInventory()) {
      player.getInventory().clear();
    }
    if (join.clearEffects()) {
      for (PotionEffect effect : player.getActivePotionEffects()) {
        player.removePotionEffect(effect.getType());
      }
    }
    if (join.setAdventure()) {
      player.setGameMode(GameMode.ADVENTURE);
    }
    if (join.sound()) {
      player.playSound(player.getLocation(), Sound.ENTITY_PLAYER_LEVELUP, 1.0f, 1.0f);
    }
    if (join.speed()) {
      player.addPotionEffect(new PotionEffect(PotionEffectType.SPEED, Integer.MAX_VALUE, join.speedAmplifier(), true, false, false));
    }
    if (join.firework()) {
      spawnFirework(player);
    }
  }

  public void handleWorldChange(Player player) {
    LobbyConfig current = config;
    if (!current.enabled()) {
      return;
    }
    String world = player.getWorld().getName();
    flightService.applyFor(player, world, current);
    if (current.isLobbyWorld(world)) {
      lobbyItemService.give(player, current);
      scoreboardService.refresh(player);
    } else {
      scoreboardService.clearFor(player);
    }
  }

  public void handleQuit(Player player) {
    visibilityService.onQuit(player);
  }

  public void teleportToSpawn(Player player) {
    Location location = spawnLocation();
    if (location == null) {
      return;
    }
    scheduler.runForPlayer(player, () -> {
      if (player.isOnline()) {
        player.teleportAsync(location);
      }
    });
  }

  public Location spawnLocation() {
    LobbyConfig.SpawnPoint spawn = config.spawn();
    World world = Bukkit.getWorld(spawn.world());
    if (world == null) {
      return null;
    }
    return new Location(world, spawn.x(), spawn.y(), spawn.z(), spawn.yaw(), spawn.pitch());
  }

  /** Saves the player's current location as the lobby spawn. */
  public boolean setSpawn(Player player) {
    Location location = player.getLocation();
    if (location.getWorld() == null) {
      return false;
    }
    FileConfiguration fileConfig = plugin.getConfig();
    fileConfig.set("lobby.spawn.world", location.getWorld().getName());
    fileConfig.set("lobby.spawn.x", round(location.getX()));
    fileConfig.set("lobby.spawn.y", round(location.getY()));
    fileConfig.set("lobby.spawn.z", round(location.getZ()));
    fileConfig.set("lobby.spawn.yaw", round(location.getYaw()));
    fileConfig.set("lobby.spawn.pitch", round(location.getPitch()));
    plugin.saveConfig();
    this.config = LobbyConfig.from(fileConfig);
    return true;
  }

  private void spawnFirework(Player player) {
    World world = player.getWorld();
    Firework firework = world.spawn(player.getLocation(), Firework.class);
    FireworkMeta meta = firework.getFireworkMeta();
    meta.addEffect(FireworkEffect.builder()
        .withColor(Color.AQUA, Color.LIME)
        .with(FireworkEffect.Type.BALL)
        .flicker(true)
        .build());
    meta.setPower(0);
    firework.setFireworkMeta(meta);
    firework.detonate();
  }

  private static double round(double value) {
    return Math.round(value * 100.0) / 100.0;
  }

  /**
   * Returns the menus section from the live config, or, if the server is running
   * an older config.yml that predates the lobby module, the menus bundled in the
   * plugin jar. This keeps the Game Menu / Lobby Selector working on upgrade.
   */
  private ConfigurationSection menusSection(FileConfiguration config) {
    ConfigurationSection section = config.getConfigurationSection("menus");
    if (section != null) {
      return section;
    }
    try (InputStream resource = plugin.getResource("config.yml")) {
      if (resource != null) {
        YamlConfiguration bundled = YamlConfiguration.loadConfiguration(
            new InputStreamReader(resource, StandardCharsets.UTF_8));
        return bundled.getConfigurationSection("menus");
      }
    } catch (IOException error) {
      plugin.getLogger().warning("RealCore could not read bundled menus: " + error.getMessage());
    }
    return null;
  }
}

