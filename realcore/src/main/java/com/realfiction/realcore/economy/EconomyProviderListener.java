package com.realfiction.realcore.economy;

import com.realfiction.realcore.RealCorePlugin;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/**
 * Preloads a player's authoritative balance into the economy provider cache, and evicts on quit.
 *
 * <p>{@code AsyncPlayerPreLoginEvent} runs off the main/region thread and is the correct place to
 * do the (potentially blocking) DB fetch, so the balance is warm before the player can run any
 * economy command. Registered once at enable; late-binds the service and no-ops while disabled.
 */
public final class EconomyProviderListener implements Listener {
  private final RealCorePlugin plugin;

  public EconomyProviderListener(RealCorePlugin plugin) {
    this.plugin = plugin;
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onPreLogin(AsyncPlayerPreLoginEvent event) {
    if (event.getLoginResult() != AsyncPlayerPreLoginEvent.Result.ALLOWED) {
      return;
    }
    EconomyProviderService service = plugin.economyProviderService();
    if (service != null) {
      service.preloadBlocking(event.getUniqueId(), event.getName());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onQuit(PlayerQuitEvent event) {
    EconomyProviderService service = plugin.economyProviderService();
    if (service != null) {
      service.onQuit(event.getPlayer().getUniqueId());
    }
  }
}
