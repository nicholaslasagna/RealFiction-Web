package com.realfiction.realcore.cosmetics;

import com.realfiction.realcore.api.dto.RewardPayload;
import com.realfiction.realcore.lobby.LobbyManager;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.text.Text;
import java.util.UUID;
import java.util.function.Supplier;
import org.bukkit.Bukkit;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

/** Applies cosmetic changes and premium messages when store entitlements change. */
public final class CosmeticEntitlementNotifier {
  private final Plugin plugin;
  private final RealCoreScheduler scheduler;
  private final Supplier<CosmeticsManager> cosmeticsSupplier;
  private final Supplier<LobbyManager> lobbySupplier;

  public CosmeticEntitlementNotifier(
      Plugin plugin,
      RealCoreScheduler scheduler,
      Supplier<CosmeticsManager> cosmeticsSupplier,
      Supplier<LobbyManager> lobbySupplier
  ) {
    this.plugin = plugin;
    this.scheduler = scheduler;
    this.cosmeticsSupplier = cosmeticsSupplier;
    this.lobbySupplier = lobbySupplier;
  }

  public void onPermissionChange(RewardPayload reward, String permission, boolean granted) {
    if (!CosmeticEntitlements.isCosmeticPermission(permission)) {
      return;
    }
    UUID uuid = parseUuid(reward == null ? null : reward.minecraftUuid());
    if (uuid == null) {
      return;
    }
    Player player = Bukkit.getPlayer(uuid);
    if (player == null || !player.isOnline()) {
      return;
    }
    scheduler.runForPlayer(player, () -> handleOnline(player, permission, granted));
  }

  private void handleOnline(Player player, String permission, boolean granted) {
    CosmeticsManager cosmetics = cosmeticsSupplier.get();
    if (cosmetics == null) {
      return;
    }
    cosmetics.applyPlayerCosmetics(player);
    if (!isLobbyWorld(player)) {
      return;
    }
    String label = Text.color(CosmeticEntitlements.displayLabel(permission));
    if (granted) {
      player.sendMessage(Text.color("&6&lRealFiction &8| &aCosmetic unlocked: " + label));
      player.sendMessage(Text.color("&7Open &f/cosmetics &7to equip your new companion."));
      player.playSound(player.getLocation(), Sound.ENTITY_PLAYER_LEVELUP, 0.35f, 1.6f);
      cosmetics.refreshGuiIfOpen(player);
    } else {
      player.sendMessage(Text.color("&6&lRealFiction &8| &7Cosmetic access changed: " + label));
      player.sendMessage(Text.color("&7Active selections were updated for your current permissions."));
      cosmetics.refreshGuiIfOpen(player);
    }
  }

  private boolean isLobbyWorld(Player player) {
    LobbyManager lobby = lobbySupplier.get();
    if (lobby == null) {
      return false;
    }
    return lobby.config().isLobbyWorld(player.getWorld().getName());
  }

  private static UUID parseUuid(String value) {
    if (value == null || value.isBlank()) {
      return null;
    }
    String normalized = value.trim();
    if (normalized.length() == 32) {
      normalized = normalized.replaceFirst(
          "([0-9a-fA-F]{8})([0-9a-fA-F]{4})([0-9a-fA-F]{4})([0-9a-fA-F]{4})([0-9a-fA-F]{12})",
          "$1-$2-$3-$4-$5"
      );
    }
    try {
      return UUID.fromString(normalized);
    } catch (IllegalArgumentException ignored) {
      return null;
    }
  }
}
