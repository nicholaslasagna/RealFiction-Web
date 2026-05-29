package com.realfiction.realcore.cosmetics;

public record CosmeticSelection(
    String usernameColor,
    String particleAura,
    String trail,
    String selectedPet,
    boolean lobbyFlight
) {
  public static CosmeticSelection defaults() {
    return new CosmeticSelection("", "", "", "", false);
  }

  public CosmeticSelection withUsernameColor(String value) {
    return new CosmeticSelection(value, particleAura, trail, selectedPet, lobbyFlight);
  }

  public CosmeticSelection withParticleAura(String value) {
    return new CosmeticSelection(usernameColor, value, trail, selectedPet, lobbyFlight);
  }

  public CosmeticSelection withTrail(String value) {
    return new CosmeticSelection(usernameColor, particleAura, value, selectedPet, lobbyFlight);
  }

  public CosmeticSelection withSelectedPet(String value) {
    return new CosmeticSelection(usernameColor, particleAura, trail, value == null ? "" : value, lobbyFlight);
  }

  public CosmeticSelection withLobbyFlight(boolean value) {
    return new CosmeticSelection(usernameColor, particleAura, trail, selectedPet, value);
  }
}
