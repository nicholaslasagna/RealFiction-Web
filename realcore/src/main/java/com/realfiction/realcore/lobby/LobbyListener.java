package com.realfiction.realcore.lobby;

import com.realfiction.realcore.text.Text;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/** Join/quit/world-change handling for the lobby. Thin: delegates to LobbyManager. */
public final class LobbyListener implements Listener {
  private final LobbyManager manager;

  public LobbyListener(LobbyManager manager) {
    this.manager = manager;
  }

  @EventHandler
  public void onJoin(PlayerJoinEvent event) {
    Player player = event.getPlayer();
    LobbyConfig config = manager.config();
    if (config.enabled()) {
      String message = config.join().joinMessage();
      if (message != null && !message.isBlank()) {
        event.joinMessage(Text.component(applyPlayer(message, player)));
      }
    }
    manager.handleJoin(player);
  }

  @EventHandler
  public void onQuit(PlayerQuitEvent event) {
    Player player = event.getPlayer();
    LobbyConfig config = manager.config();
    if (config.enabled()) {
      String message = config.join().quitMessage();
      if (message != null && !message.isBlank()) {
        event.quitMessage(Text.component(applyPlayer(message, player)));
      }
    }
    manager.handleQuit(player);
  }

  @EventHandler
  public void onWorldChange(PlayerChangedWorldEvent event) {
    manager.handleWorldChange(event.getPlayer());
  }

  private String applyPlayer(String message, Player player) {
    int online = Bukkit.getOnlinePlayers().size();
    int maxOnline = Bukkit.getMaxPlayers();
    return Text.placeholders(message, player.getName(), player.getUniqueId().toString(), online, maxOnline);
  }
}
