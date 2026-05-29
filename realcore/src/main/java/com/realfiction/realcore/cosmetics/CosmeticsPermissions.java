package com.realfiction.realcore.cosmetics;

import org.bukkit.entity.Player;
import org.bukkit.permissions.Permissible;

/** LuckPerms/Bukkit permission checks for cosmetics. */
final class CosmeticsPermissions {
  private CosmeticsPermissions() {
  }

  static boolean canUseCategory(
      Permissible player,
      CosmeticCategory category,
      CosmeticsConfig.CategorySettings settings
  ) {
    if (player == null || settings == null || !settings.enabled()) {
      return false;
    }
    if (category == CosmeticCategory.LOBBY_FLIGHT) {
      return player.hasPermission(CosmeticsConstants.PERM_LOBBY_FLIGHT);
    }
    String permission = settings.permission();
    if (permission == null || permission.isBlank()) {
      return true;
    }
    return player.hasPermission(permission);
  }

  static boolean canUseOption(Permissible player, CosmeticOption option) {
    if (player == null || option == null) {
      return false;
    }
    if (!option.requiresPermission()) {
      return true;
    }
    return player.hasPermission(option.permission());
  }

  static boolean canUseStoredSelection(
      Permissible player,
      CosmeticsConfig config,
      CosmeticCategory category,
      String optionId
  ) {
    if (optionId == null || optionId.isBlank()) {
      return false;
    }
    CosmeticOption option = config.option(category, optionId);
    return option != null && canUseOption(player, option);
  }

  /**
   * Drops stored selections the player no longer has permission to use.
   *
   * @return sanitized selection and whether anything changed
   */
  static SanitizeResult sanitize(Permissible player, CosmeticsConfig config, CosmeticSelection selection) {
    CosmeticSelection current = selection == null ? CosmeticSelection.defaults() : selection;
    boolean changed = false;

    if (!current.usernameColor().isBlank()
        && !canUseStoredSelection(player, config, CosmeticCategory.USERNAME_COLORS, current.usernameColor())) {
      current = current.withUsernameColor("");
      changed = true;
    }
    if (!current.particleAura().isBlank()
        && !canUseStoredSelection(player, config, CosmeticCategory.PARTICLES, current.particleAura())) {
      current = current.withParticleAura("");
      changed = true;
    }
    if (!current.trail().isBlank()
        && !canUseStoredSelection(player, config, CosmeticCategory.TRAILS, current.trail())) {
      current = current.withTrail("");
      changed = true;
    }
    if (!current.selectedPet().isBlank()
        && !canUseStoredSelection(player, config, CosmeticCategory.PETS, current.selectedPet())) {
      current = current.withSelectedPet("");
      changed = true;
    }
    if (current.lobbyFlight() && !player.hasPermission(CosmeticsConstants.PERM_LOBBY_FLIGHT)) {
      current = current.withLobbyFlight(false);
      changed = true;
    }

    return new SanitizeResult(current, changed);
  }

  record SanitizeResult(CosmeticSelection selection, boolean changed) {
  }
}
