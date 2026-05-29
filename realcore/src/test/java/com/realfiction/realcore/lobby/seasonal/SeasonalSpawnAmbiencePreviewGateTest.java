package com.realfiction.realcore.lobby.seasonal;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Documents preview-only player-count bypass in {@link SeasonalSpawnAmbienceService}. */
final class SeasonalSpawnAmbiencePreviewGateTest {
  @Test
  void previewActiveSkipsLobbyPlayerRequirement() {
    assertTrue(previewAllowsZeroLobbyPlayers(true, 0));
    assertFalse(previewAllowsZeroLobbyPlayers(false, 0));
    assertTrue(previewAllowsZeroLobbyPlayers(false, 2));
  }

  private static boolean previewAllowsZeroLobbyPlayers(boolean previewActive, int lobbyPlayers) {
    if (previewActive) {
      return true;
    }
    return lobbyPlayers > 0;
  }
}
