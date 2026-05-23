package com.realfiction.realcore.playtime;

import com.realfiction.realcore.RealCorePlugin;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/**
 * Captures join/quit on the event thread and hands UUID + name to the tracker.
 * Late-binds the tracker through the plugin so a reload can swap it safely.
 */
public final class PlaytimeListener implements Listener {
  private final RealCorePlugin plugin;

  public PlaytimeListener(RealCorePlugin plugin) {
    this.plugin = plugin;
  }

  @EventHandler
  public void onJoin(PlayerJoinEvent event) {
    PlaytimeTracker tracker = plugin.playtimeTracker();
    if (tracker != null) {
      Player player = event.getPlayer();
      tracker.onJoin(player.getUniqueId(), player.getName());
    }
  }

  @EventHandler
  public void onQuit(PlayerQuitEvent event) {
    PlaytimeTracker tracker = plugin.playtimeTracker();
    if (tracker != null) {
      Player player = event.getPlayer();
      tracker.onQuit(player.getUniqueId(), player.getName());
    }
  }
}
