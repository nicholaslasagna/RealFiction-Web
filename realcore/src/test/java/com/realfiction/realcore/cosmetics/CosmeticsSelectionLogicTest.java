package com.realfiction.realcore.cosmetics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

final class CosmeticsSelectionLogicTest {
  @Test
  void togglesParticleSelectionOnAndOff() {
    CosmeticSelection empty = CosmeticSelection.defaults();
    CosmeticSelection equipped = CosmeticsSelectionLogic.applySelection(empty, CosmeticCategory.PARTICLES, "emerald-aura", false);
    assertEquals("emerald-aura", equipped.particleAura());

    CosmeticSelection cleared = CosmeticsSelectionLogic.applySelection(equipped, CosmeticCategory.PARTICLES, "emerald-aura", true);
    assertEquals("", cleared.particleAura());
  }

  @Test
  void togglesPetSelectionOnAndOff() {
    CosmeticSelection empty = CosmeticSelection.defaults();
    CosmeticSelection equipped = CosmeticsSelectionLogic.applySelection(empty, CosmeticCategory.PETS, "fox-friend", false);
    assertEquals("fox-friend", equipped.selectedPet());

    CosmeticSelection cleared = CosmeticsSelectionLogic.applySelection(equipped, CosmeticCategory.PETS, "fox-friend", true);
    assertEquals("", cleared.selectedPet());
  }

  @Test
  void clearsUsernameColorCategory() {
    CosmeticSelection equipped = new CosmeticSelection("gold", "", "", "", false);
    CosmeticSelection cleared = CosmeticsSelectionLogic.clearCategory(equipped, CosmeticCategory.USERNAME_COLORS);
    assertEquals("", cleared.usernameColor());
  }

  @Test
  void clearsPetCategory() {
    CosmeticSelection equipped = new CosmeticSelection("", "", "", "tiny-dragon", false);
    CosmeticSelection cleared = CosmeticsSelectionLogic.clearCategory(equipped, CosmeticCategory.PETS);
    assertEquals("", cleared.selectedPet());
  }

  @Test
  void lobbyFlightTogglesBoolean() {
    CosmeticSelection off = CosmeticSelection.defaults();
    CosmeticSelection on = CosmeticsSelectionLogic.applySelection(off, CosmeticCategory.LOBBY_FLIGHT, "toggle", false);
    assertTrue(on.lobbyFlight());
    CosmeticSelection offAgain = CosmeticsSelectionLogic.applySelection(on, CosmeticCategory.LOBBY_FLIGHT, "toggle", false);
    assertFalse(offAgain.lobbyFlight());
  }

  @Test
  void detectsActiveSelections() {
    CosmeticSelection selection = new CosmeticSelection("", "emerald-aura", "", "bee-buzz", false);
    assertTrue(CosmeticsSelectionLogic.hasActiveSelection(selection, CosmeticCategory.PARTICLES));
    assertTrue(CosmeticsSelectionLogic.hasActiveSelection(selection, CosmeticCategory.PETS));
    assertFalse(CosmeticsSelectionLogic.hasActiveSelection(selection, CosmeticCategory.TRAILS));
  }
}
