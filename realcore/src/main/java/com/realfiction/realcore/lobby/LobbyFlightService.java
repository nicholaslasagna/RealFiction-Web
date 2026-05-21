package com.realfiction.realcore.lobby;

import com.realfiction.realcore.scheduler.RealCoreScheduler;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.bukkit.GameMode;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerToggleFlightEvent;
import org.bukkit.util.Vector;

/**
 * Applies lobby movement perks. Default players get walk speed + double jump;
 * real flight is reserved for the configured paid/supporter permission.
 */
public final class LobbyFlightService {
  private final RealCoreScheduler scheduler;
  private final Map<UUID, Float> previousWalkSpeeds = new ConcurrentHashMap<>();

  public LobbyFlightService(RealCoreScheduler scheduler) {
    this.scheduler = scheduler;
  }

  public void applyFor(Player player, LobbyConfig config) {
    scheduler.runForPlayer(player, () -> {
      if (!player.isOnline()) {
        return;
      }
      applyNow(player, config);
    });
  }

  public void handleToggleFlight(PlayerToggleFlightEvent event, LobbyConfig config) {
    Player player = event.getPlayer();
    if (!canUseDoubleJump(player, config)) {
      return;
    }

    event.setCancelled(true);
    player.setFlying(false);
    player.setAllowFlight(false);

    Vector direction = player.getLocation().getDirection().setY(0);
    if (direction.lengthSquared() > 0.0D) {
      direction.normalize().multiply(config.doubleJump().forwardVelocity());
    }
    direction.setY(config.doubleJump().upwardVelocity());
    player.setVelocity(direction);
    player.playSound(player.getLocation(), Sound.ENTITY_BAT_TAKEOFF, 0.6F, 1.4F);

    scheduler.runForPlayerLater(player, () -> restoreDoubleJumpIfReady(player, config), config.doubleJump().resetDelayTicks());
  }

  public void handleMove(Player player, LobbyConfig config) {
    if (player.isOnGround()) {
      restoreDoubleJumpIfReady(player, config);
    }
  }

  public void forget(Player player) {
    previousWalkSpeeds.remove(player.getUniqueId());
  }

  private void applyNow(Player player, LobbyConfig config) {
      GameMode mode = player.getGameMode();
      // Creative/spectator manage their own flight; never fight the gamemode.
      if (mode == GameMode.CREATIVE || mode == GameMode.SPECTATOR) {
        restoreWalkSpeed(player);
        return;
      }

      boolean inLobby = config.isLobbyWorld(player.getWorld().getName());
      boolean hasPaidFlight = inLobby
          && config.flight().enabled()
          && player.hasPermission(config.flight().permission());

      if (inLobby) {
        applyWalkSpeed(player, config);
      } else {
        restoreWalkSpeed(player);
      }

      if (hasPaidFlight) {
        player.setAllowFlight(true);
        return;
      }

      // Outside lobby or no paid permission: remove real flight. Double-jump
      // will re-enable allowFlight for lobby players without allowing flight.
      player.setAllowFlight(false);
      player.setFlying(false);

      restoreDoubleJumpIfReady(player, config);
  }

  private void applyWalkSpeed(Player player, LobbyConfig config) {
    if (!config.walkSpeed().enabled()) {
      restoreWalkSpeed(player);
      return;
    }
    previousWalkSpeeds.putIfAbsent(player.getUniqueId(), player.getWalkSpeed());
    if (Float.compare(player.getWalkSpeed(), config.walkSpeed().speed()) != 0) {
      player.setWalkSpeed(config.walkSpeed().speed());
    }
  }

  private void restoreWalkSpeed(Player player) {
    Float previous = previousWalkSpeeds.remove(player.getUniqueId());
    if (previous != null && Float.compare(player.getWalkSpeed(), previous) != 0) {
      player.setWalkSpeed(previous);
    }
  }

  private void restoreDoubleJumpIfReady(Player player, LobbyConfig config) {
    if (!canUseDoubleJump(player, config)) {
      return;
    }
    if (player.isOnGround()) {
      player.setAllowFlight(true);
    }
  }

  private boolean canUseDoubleJump(Player player, LobbyConfig config) {
    if (!player.isOnline() || !config.doubleJump().enabled() || !config.isLobbyWorld(player.getWorld().getName())) {
      return false;
    }
    GameMode mode = player.getGameMode();
    if (mode == GameMode.CREATIVE || mode == GameMode.SPECTATOR) {
      return false;
    }
    return !config.flight().enabled() || !player.hasPermission(config.flight().permission());
  }
}
