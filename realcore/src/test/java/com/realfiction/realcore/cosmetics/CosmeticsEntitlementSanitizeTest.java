package com.realfiction.realcore.cosmetics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Verifies stored cosmetic selections clear when categories are cleared (revoke path). */
final class CosmeticsEntitlementSanitizeTest {
  @Test
  void clearCategoryRemovesPetParticleTrailAndColor() {
    CosmeticSelection stored = new CosmeticSelection("gold", "emerald-aura", "cloud-trail", "fox-friend", true);
    CosmeticSelection cleared = CosmeticsSelectionLogic.clearCategory(stored, CosmeticCategory.PETS);
    assertEquals("", cleared.selectedPet());
    assertEquals("gold", cleared.usernameColor());

    cleared = CosmeticsSelectionLogic.clearCategory(cleared, CosmeticCategory.PARTICLES);
    assertEquals("", cleared.particleAura());

    cleared = CosmeticsSelectionLogic.clearCategory(cleared, CosmeticCategory.TRAILS);
    assertEquals("", cleared.trail());

    cleared = CosmeticsSelectionLogic.clearCategory(cleared, CosmeticCategory.USERNAME_COLORS);
    assertEquals("", cleared.usernameColor());

    cleared = CosmeticsSelectionLogic.clearCategory(cleared, CosmeticCategory.LOBBY_FLIGHT);
    assertFalse(cleared.lobbyFlight());
  }
}
