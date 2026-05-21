package com.realfiction.realcore.linking;

import com.realfiction.realcore.RealCorePlugin;
import com.realfiction.realcore.api.PlatformApiClient;
import com.realfiction.realcore.api.dto.LinkConfirmRequest;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import java.util.Locale;
import org.bukkit.ChatColor;
import org.bukkit.entity.Player;

public final class AccountLinkService {
  private final RealCorePlugin plugin;
  private final RealCoreConfig config;
  private final RealCoreScheduler scheduler;
  private final PlatformApiClient apiClient;

  public AccountLinkService(RealCorePlugin plugin, RealCoreConfig config, RealCoreScheduler scheduler, PlatformApiClient apiClient) {
    this.plugin = plugin;
    this.config = config;
    this.scheduler = scheduler;
    this.apiClient = apiClient;
  }

  public void confirm(Player player, String code) {
    if (!config.hmacSecretConfigured()) {
      scheduler.runForPlayer(player, () -> player.sendMessage(ChatColor.RED + "RealFiction linking is not ready yet. Please tell staff."));
      return;
    }

    String playerName = player.getName();
    String playerUuid = player.getUniqueId().toString();
    String cleanCode = code.trim().toUpperCase(Locale.ROOT);
    LinkConfirmRequest request = new LinkConfirmRequest(
        config.serverId(),
        cleanCode,
        playerUuid,
        playerName,
        config.linkPlatform()
    );

    apiClient.confirmLink(request).whenComplete((response, error) -> {
      if (error != null) {
        plugin.getLogger().warning("Account link failed for player=" + playerName + ": " + error.getMessage());
        scheduler.runForPlayer(player, () -> player.sendMessage(ChatColor.RED + "That link code did not work. Try again or ask staff for help."));
        return;
      }

      if (response != null && response.confirmed) {
        plugin.getLogger().info("Linked RealFiction account for player=" + playerName);
        scheduler.runForPlayer(player, () -> player.sendMessage(ChatColor.GREEN + "Your Minecraft account is linked to RealFiction."));
        return;
      }

      scheduler.runForPlayer(player, () -> player.sendMessage(ChatColor.RED + "That link code is invalid or expired."));
    });
  }
}
