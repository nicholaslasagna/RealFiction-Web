package com.realfiction.realcore.economy;

import com.realfiction.realcore.RealCorePlugin;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/**
 * Triggers a DB-to-Vault balance reconcile when a player joins this backend, and flushes any queued
 * captures when they leave so the global balance is current before a server switch.
 *
 * <p>Registered once at enable; it late-binds the reconciliation service via the plugin so a
 * reload can swap it, and no-ops cleanly whenever reconciliation is disabled or not loaded.
 */
public final class EconomyReconciliationListener implements Listener {
  private final RealCorePlugin plugin;

  public EconomyReconciliationListener(RealCorePlugin plugin) {
    this.plugin = plugin;
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onPlayerJoin(PlayerJoinEvent event) {
    EconomyReconciliationService service = plugin.economyReconciliationService();
    if (service != null) {
      service.onPlayerJoin(event.getPlayer());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onPlayerQuit(PlayerQuitEvent event) {
    EconomyReconciliationService service = plugin.economyReconciliationService();
    if (service != null) {
      service.flushPendingCaptures();
    }
  }
}
