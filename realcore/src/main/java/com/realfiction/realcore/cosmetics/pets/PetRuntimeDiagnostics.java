package com.realfiction.realcore.cosmetics.pets;

import java.util.concurrent.atomic.AtomicReference;

/** Last pet spawn failure for /rf status diagnostics. */
public final class PetRuntimeDiagnostics {
  private final AtomicReference<String> lastSpawnFailure = new AtomicReference<>("");

  public void recordSpawnFailure(String petId, String reason) {
    if (reason == null || reason.isBlank()) {
      return;
    }
    lastSpawnFailure.set(petId + ": " + reason);
  }

  public void clearSpawnFailure() {
    lastSpawnFailure.set("");
  }

  public String lastSpawnFailure() {
    return lastSpawnFailure.get();
  }
}
