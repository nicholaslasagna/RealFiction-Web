package com.realfiction.realcore.scoreboard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

final class ScoreboardRuntimeGuardTest {
  @Test
  void unsupportedOperationDisablesScoreboardsAndWarnsOnce() {
    ScoreboardRuntimeGuard guard = new ScoreboardRuntimeGuard();
    List<String> warnings = new ArrayList<>();

    assertTrue(guard.available());
    assertTrue(guard.disableIfUnsupported(new UnsupportedOperationException(), warnings::add));
    assertFalse(guard.available());
    assertEquals(ScoreboardRuntimeGuard.FOLIA_UNSUPPORTED_REASON, guard.unavailableReason());
    assertEquals(1, warnings.size());

    assertTrue(guard.disableIfUnsupported(new UnsupportedOperationException(), warnings::add));
    assertEquals(1, warnings.size(), "Folia scoreboard failures must not spam WARN logs");
  }

  @Test
  void nonUnsupportedOperationIsNotSwallowed() {
    ScoreboardRuntimeGuard guard = new ScoreboardRuntimeGuard();
    List<String> warnings = new ArrayList<>();

    assertFalse(guard.disableIfUnsupported(new IllegalStateException("boom"), warnings::add));
    assertTrue(guard.available());
    assertEquals(0, warnings.size());
  }
}
