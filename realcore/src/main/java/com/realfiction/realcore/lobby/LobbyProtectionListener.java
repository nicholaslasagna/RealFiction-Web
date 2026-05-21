package com.realfiction.realcore.lobby;

import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockIgniteEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.block.BlockSpreadEvent;
import org.bukkit.event.block.LeavesDecayEvent;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.entity.FoodLevelChangeEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerSwapHandItemsEvent;
import org.bukkit.event.weather.WeatherChangeEvent;

/** Config-driven lobby protections. Every handler is gated to lobby worlds. */
public final class LobbyProtectionListener implements Listener {
  private static final String BYPASS = "realcore.lobby.bypass";

  private final LobbyManager manager;

  public LobbyProtectionListener(LobbyManager manager) {
    this.manager = manager;
  }

  private boolean inLobby(String worldName) {
    return manager.config().isLobbyWorld(worldName);
  }

  private LobbyConfig.Protection protection() {
    return manager.config().protection();
  }

  @EventHandler(ignoreCancelled = true)
  public void onHunger(FoodLevelChangeEvent event) {
    if (!(event.getEntity() instanceof Player player)) {
      return;
    }
    if (protection().hunger() && inLobby(player.getWorld().getName())) {
      event.setFoodLevel(20);
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onDamage(EntityDamageEvent event) {
    if (!(event.getEntity() instanceof Player player) || !inLobby(player.getWorld().getName())) {
      return;
    }
    LobbyConfig.Protection protection = protection();
    switch (event.getCause()) {
      case FIRE, FIRE_TICK, LAVA, HOT_FLOOR -> {
        if (protection.fire()) {
          event.setCancelled(true);
        }
      }
      case DROWNING -> {
        if (protection.drowning()) {
          event.setCancelled(true);
        }
      }
      case VOID -> {
        if (protection.voidDamage()) {
          event.setCancelled(true);
          manager.teleportToSpawn(player);
        }
      }
      default -> {
        // other causes handled elsewhere or allowed
      }
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onPvp(EntityDamageByEntityEvent event) {
    if (!(event.getEntity() instanceof Player victim) || !inLobby(victim.getWorld().getName())) {
      return;
    }
    if (!protection().pvp()) {
      return;
    }
    Entity damager = event.getDamager();
    boolean playerSource = damager instanceof Player
        || (damager instanceof Projectile projectile && projectile.getShooter() instanceof Player);
    if (playerSource) {
      event.setCancelled(true);
    }
  }

  @EventHandler
  public void onDeath(PlayerDeathEvent event) {
    if (protection().deathMessages() && inLobby(event.getEntity().getWorld().getName())) {
      event.deathMessage(null);
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onMobSpawn(CreatureSpawnEvent event) {
    if (!protection().mobSpawning() || !inLobby(event.getLocation().getWorld().getName())) {
      return;
    }
    switch (event.getSpawnReason()) {
      case CUSTOM, COMMAND, SPAWNER_EGG -> {
        // allow intentional/admin spawns
      }
      default -> event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onDrop(PlayerDropItemEvent event) {
    if (protection().itemDrop() && inLobby(event.getPlayer().getWorld().getName())
        && !event.getPlayer().hasPermission(BYPASS)) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onPickup(EntityPickupItemEvent event) {
    if (!(event.getEntity() instanceof Player player)) {
      return;
    }
    if (protection().itemPickup() && inLobby(player.getWorld().getName()) && !player.hasPermission(BYPASS)) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onBreak(BlockBreakEvent event) {
    if (protection().blockBreak() && inLobby(event.getBlock().getWorld().getName())
        && !event.getPlayer().hasPermission(BYPASS)) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onPlace(BlockPlaceEvent event) {
    if (protection().blockPlace() && inLobby(event.getBlock().getWorld().getName())
        && !event.getPlayer().hasPermission(BYPASS)) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onInteract(PlayerInteractEvent event) {
    if (!protection().blockInteract() || event.getClickedBlock() == null) {
      return;
    }
    if (event.getAction() != Action.RIGHT_CLICK_BLOCK && event.getAction() != Action.LEFT_CLICK_BLOCK) {
      return;
    }
    Player player = event.getPlayer();
    if (inLobby(player.getWorld().getName()) && !player.hasPermission(BYPASS)) {
      // Deny block use but leave item use intact so lobby items still work.
      event.setUseInteractedBlock(Event.Result.DENY);
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onBurn(BlockBurnEvent event) {
    if (protection().fireSpread() && inLobby(event.getBlock().getWorld().getName())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onSpread(BlockSpreadEvent event) {
    if (protection().fireSpread() && inLobby(event.getBlock().getWorld().getName())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onIgnite(BlockIgniteEvent event) {
    if (protection().fireSpread() && inLobby(event.getBlock().getWorld().getName())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onLeafDecay(LeavesDecayEvent event) {
    if (protection().leafDecay() && inLobby(event.getBlock().getWorld().getName())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  public void onSwapHand(PlayerSwapHandItemsEvent event) {
    if (protection().offhandSwap() && inLobby(event.getPlayer().getWorld().getName())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onWeather(WeatherChangeEvent event) {
    if (protection().weather() && event.toWeatherState() && inLobby(event.getWorld().getName())) {
      event.setCancelled(true);
    }
  }
}
