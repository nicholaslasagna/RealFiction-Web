package com.realfiction.realcore.scoreboard;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

final class ScoreboardRuntimeGuard {
  static final String FOLIA_UNSUPPORTED_REASON =
      "Scoreboards are unavailable on this Folia runtime because Bukkit scoreboard creation is unsupported; "
          + "disabling RealCore scoreboard updates. Menus/placeholders/economy are unaffected.";

  private final AtomicBoolean available = new AtomicBoolean(true);
  private final AtomicBoolean warned = new AtomicBoolean(false);
  private volatile String unavailableReason = "";

  boolean available() {
    return available.get();
  }

  String unavailableReason() {
    return unavailableReason;
  }

  boolean disableIfUnsupported(Throwable error, Consumer<String> warningSink) {
    if (!(error instanceof UnsupportedOperationException)) {
      return false;
    }
    disable(FOLIA_UNSUPPORTED_REASON, warningSink);
    return true;
  }

  void disable(String reason, Consumer<String> warningSink) {
    String message = reason == null || reason.isBlank() ? "Scoreboards are unavailable." : reason;
    available.set(false);
    unavailableReason = message;
    if (warned.compareAndSet(false, true) && warningSink != null) {
      warningSink.accept(message);
    }
  }
}
