package com.realfiction.realcore.cosmetics.pets;

/** Pure lobby pet equip rules (testable without spawning entities). */
public final class PetLobbyRules {
  private PetLobbyRules() {
  }

  public static boolean shouldEquipPet(
      boolean serviceEnabled,
      boolean playerOnline,
      boolean playerDead,
      boolean playerInvisible,
      boolean inLobbyWorld,
      String selectedPetId,
      boolean validNonPlaceholderOption,
      boolean hasPermission,
      PetDefinition definition
  ) {
    if (!serviceEnabled || !playerOnline || playerDead || playerInvisible) {
      return false;
    }
    if (!inLobbyWorld) {
      return false;
    }
    if (selectedPetId == null || selectedPetId.isBlank()) {
      return false;
    }
    if (!validNonPlaceholderOption || !hasPermission) {
      return false;
    }
    return definition != null;
  }
}
