package com.realfiction.realcore.lobby;

import com.realfiction.realcore.scheduler.RealCoreScheduler;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

/**
 * Per-player "see other players" toggle with a cooldown. Visibility is
 * viewer-side: hiding affects only what the toggling player sees. The online
 * player list is read on the global region; show/hide is applied on each
 * viewer's scheduler for Folia safety.
 */
public final class VisibilityService {
  private final Plugin plugin;
  private final RealCoreScheduler scheduler;
  private final Map<UUID, Boolean> seeOthers = new ConcurrentHashMap<>();
  private final Map<UUID, Long> cooldownUntil = new ConcurrentHashMap<>();

  public VisibilityService(Plugin plugin, RealCoreScheduler scheduler) {
    this.plugin = plugin;
    this.scheduler = scheduler;
  }

  public boolean seeOthers(Player player) {
    return seeOthers.getOrDefault(player.getUniqueId(), Boolean.TRUE);
  }

  public void toggle(Player player, int cooldownSeconds) {
    long now = System.currentTimeMillis();
    long until = cooldownUntil.getOrDefault(player.getUniqueId(), 0L);
    if (now < until) {
      long remaining = (until - now + 999L) / 1000L;
      scheduler.send(player, ChatColor.RED + "Please wait " + remaining + "s before toggling again.");
      return;
    }

    boolean newState = !seeOthers(player);
    seeOthers.put(player.getUniqueId(), newState);
    if (cooldownSeconds > 0) {
      cooldownUntil.put(player.getUniqueId(), now + (cooldownSeconds * 1000L));
    }
    applyForViewer(player);
    scheduler.send(player, newState
        ? ChatColor.GREEN + "Players are now visible."
        : ChatColor.RED + "Players are now hidden.");
  }

  public void applyForViewer(Player viewer) {
    boolean show = seeOthers(viewer);
    UUID viewerId = viewer.getUniqueId();
    scheduler.runGlobal(() -> {
      for (Player other : Bukkit.getOnlinePlayers()) {
        if (other.getUniqueId().equals(viewerId)) {
          continue;
        }
        scheduler.runForPlayer(viewer, () -> {
          if (!viewer.isOnline() || !other.isOnline()) {
            return;
          }
          if (show) {
            viewer.showPlayer(plugin, other);
          } else {
            viewer.hidePlayer(plugin, other);
          }
        });
      }
    });
  }

  public void onJoin(Player joiner) {
    applyForViewer(joiner);
    UUID joinerId = joiner.getUniqueId();
    scheduler.runGlobal(() -> {
      for (Player viewer : Bukkit.getOnlinePlayers()) {
        if (viewer.getUniqueId().equals(joinerId) || seeOthers(viewer)) {
          continue;
        }
        scheduler.runForPlayer(viewer, () -> {
          if (viewer.isOnline() && joiner.isOnline()) {
            viewer.hidePlayer(plugin, joiner);
          }
        });
      }
    });
  }

  public void onQuit(Player player) {
    seeOthers.remove(player.getUniqueId());
    cooldownUntil.remove(player.getUniqueId());
  }
}
