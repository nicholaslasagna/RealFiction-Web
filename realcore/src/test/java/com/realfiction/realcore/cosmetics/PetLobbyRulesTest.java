package com.realfiction.realcore.cosmetics;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.cosmetics.pets.PetCosmetics;
import com.realfiction.realcore.cosmetics.pets.PetDefinition;
import com.realfiction.realcore.cosmetics.pets.PetLobbyRules;
import org.junit.jupiter.api.Test;

final class PetLobbyRulesTest {
  @Test
  void equipsWhenLobbySelectionPermissionAndDefinitionValid() {
    PetDefinition fox = PetCosmetics.definition("fox-friend");
    assertTrue(PetLobbyRules.shouldEquipPet(
        true, true, false, false, true, "fox-friend", true, true, fox));
  }

  @Test
  void doesNotEquipOutsideLobby() {
    PetDefinition fox = PetCosmetics.definition("fox-friend");
    assertFalse(PetLobbyRules.shouldEquipPet(
        true, true, false, false, false, "fox-friend", true, true, fox));
  }

  @Test
  void doesNotEquipWithoutPermission() {
    PetDefinition fox = PetCosmetics.definition("fox-friend");
    assertFalse(PetLobbyRules.shouldEquipPet(
        true, true, false, false, true, "fox-friend", true, false, fox));
  }

  @Test
  void doesNotEquipWhenOfflineDeadOrVanished() {
    PetDefinition fox = PetCosmetics.definition("fox-friend");
    assertFalse(PetLobbyRules.shouldEquipPet(
        true, false, false, false, true, "fox-friend", true, true, fox));
    assertFalse(PetLobbyRules.shouldEquipPet(
        true, true, true, false, true, "fox-friend", true, true, fox));
    assertFalse(PetLobbyRules.shouldEquipPet(
        true, true, false, true, true, "fox-friend", true, true, fox));
  }
}
