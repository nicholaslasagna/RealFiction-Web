package com.realfiction.realcore.cosmetics;

public record CosmeticSelection(
    String usernameColor,
    String particleAura,
    String trail,
    boolean lobbyFlight
) {
  public static CosmeticSelection defaults() {
    return new CosmeticSelection("", "", "", true);
  }

  public CosmeticSelection withUsernameColor(String value) {
    return new CosmeticSelection(value, particleAura, trail, lobbyFlight);
  }

  public CosmeticSelection withParticleAura(String value) {
    return new CosmeticSelection(usernameColor, value, trail, lobbyFlight);
  }

  public CosmeticSelection withTrail(String value) {
    return new CosmeticSelection(usernameColor, particleAura, value, lobbyFlight);
  }

  public CosmeticSelection withLobbyFlight(boolean value) {
    return new CosmeticSelection(usernameColor, particleAura, trail, value);
  }
}
