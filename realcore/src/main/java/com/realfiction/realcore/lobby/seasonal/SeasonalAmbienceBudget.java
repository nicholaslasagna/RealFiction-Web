package com.realfiction.realcore.lobby.seasonal;

/** Particle/sound caps for lobby spawn ambience bursts. */
public final class SeasonalAmbienceBudget {
  static final int BASE_PARTICLES = 6;
  static final int PARTICLES_PER_PLAYER = 2;
  static final int MAX_PARTICLES_PER_BURST = 24;
  static final int MAX_SOUNDS_PER_BURST = 1;
  static final double MIN_RADIUS = 6.0D;
  static final double MAX_RADIUS = 14.0D;
  static final double SOUND_RADIUS = 32.0D;

  private SeasonalAmbienceBudget() {
  }

  public static int particleBudget(int lobbyPlayerCount) {
    if (lobbyPlayerCount <= 0) {
      return 0;
    }
    int budget = BASE_PARTICLES + (lobbyPlayerCount * PARTICLES_PER_PLAYER);
    return Math.min(MAX_PARTICLES_PER_BURST, budget);
  }

  public static boolean shouldPlaySound(int lobbyPlayerCount) {
    return lobbyPlayerCount > 0;
  }
}
