package com.realfiction.realcore.cosmetics;

import java.util.Objects;

/** Pure selection transitions for cosmetics (testable, no Bukkit). */
final class CosmeticsSelectionLogic {
  private CosmeticsSelectionLogic() {
  }

  static CosmeticSelection clearCategory(CosmeticSelection current, CosmeticCategory category) {
    Objects.requireNonNull(current, "current");
    Objects.requireNonNull(category, "category");
    return switch (category) {
      case USERNAME_COLORS -> current.withUsernameColor("");
      case PARTICLES -> current.withParticleAura("");
      case TRAILS -> current.withTrail("");
      case LOBBY_FLIGHT -> current.withLobbyFlight(false);
      case PETS -> current.withSelectedPet("");
    };
  }

  static CosmeticSelection applySelection(
      CosmeticSelection current,
      CosmeticCategory category,
      String optionId,
      boolean alreadySelected
  ) {
    Objects.requireNonNull(current, "current");
    Objects.requireNonNull(category, "category");
    String id = optionId == null ? "" : optionId;
    return switch (category) {
      case USERNAME_COLORS -> alreadySelected ? current.withUsernameColor("") : current.withUsernameColor(id);
      case PARTICLES -> alreadySelected ? current.withParticleAura("") : current.withParticleAura(id);
      case TRAILS -> alreadySelected ? current.withTrail("") : current.withTrail(id);
      case LOBBY_FLIGHT -> current.withLobbyFlight(!current.lobbyFlight());
      case PETS -> alreadySelected ? current.withSelectedPet("") : current.withSelectedPet(id);
    };
  }

  static boolean isSelected(CosmeticSelection selection, CosmeticCategory category, String optionId) {
    if (selection == null || optionId == null || optionId.isBlank()) {
      return false;
    }
    return switch (category) {
      case USERNAME_COLORS -> optionId.equals(selection.usernameColor());
      case PARTICLES -> optionId.equals(selection.particleAura());
      case TRAILS -> optionId.equals(selection.trail());
      case LOBBY_FLIGHT -> selection.lobbyFlight();
      case PETS -> optionId.equals(selection.selectedPet());
    };
  }

  static boolean hasActiveSelection(CosmeticSelection selection, CosmeticCategory category) {
    if (selection == null) {
      return false;
    }
    return switch (category) {
      case USERNAME_COLORS -> !selection.usernameColor().isBlank();
      case PARTICLES -> !selection.particleAura().isBlank();
      case TRAILS -> !selection.trail().isBlank();
      case LOBBY_FLIGHT -> selection.lobbyFlight();
      case PETS -> !selection.selectedPet().isBlank();
    };
  }
}
