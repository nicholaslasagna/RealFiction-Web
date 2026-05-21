package com.realfiction.realcore.lobby;

import com.realfiction.realcore.scheduler.RealCoreScheduler;
import org.bukkit.GameMode;
import org.bukkit.entity.Player;

/** Grants lobby flight to permitted players, removing it outside lobby worlds. */
public final class LobbyFlightService {
  private final RealCoreScheduler scheduler;

  public LobbyFlightService(RealCoreScheduler scheduler) {
    this.scheduler = scheduler;
  }

  public void applyFor(Player player, String worldName, LobbyConfig config) {
    scheduler.runForPlayer(player, () -> {
      if (!player.isOnline()) {
        return;
      }
      GameMode mode = player.getGameMode();
      // Creative/spectator manage their own flight; never fight the gamemode.
      if (mode == GameMode.CREATIVE || mode == GameMode.SPECTATOR) {
        return;
      }

      boolean inLobby = config.isLobbyWorld(worldName);
      boolean allowed = inLobby
          && config.flight().enabled()
          && player.hasPermission(config.flight().permission());

      if (allowed) {
        player.setAllowFlight(true);
        return;
      }

      // Outside lobby (or no permission): remove lobby-granted flight.
      player.setAllowFlight(false);
      player.setFlying(false);
    });
  }
}
