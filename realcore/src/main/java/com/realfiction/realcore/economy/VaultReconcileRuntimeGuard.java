package com.realfiction.realcore.economy;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

final class VaultReconcileRuntimeGuard {
  static final String VAULT_UNAVAILABLE_REASON =
      "Vault economy provider unavailable; disabling Vault reconciliation for this runtime. "
          + "Canonical ledger/gameplaySync remain available.";

  private final AtomicBoolean enabled = new AtomicBoolean(true);
  private final AtomicBoolean warned = new AtomicBoolean(false);
  private volatile String disabledReason = "";

  boolean enabled() {
    return enabled.get();
  }

  boolean disabled() {
    return !enabled.get();
  }

  String disabledReason() {
    return disabledReason;
  }

  void disableVaultUnavailable(Consumer<String> warningSink) {
    disable(VAULT_UNAVAILABLE_REASON, warningSink);
  }

  void disable(String reason, Consumer<String> warningSink) {
    String message = reason == null || reason.isBlank() ? VAULT_UNAVAILABLE_REASON : reason;
    enabled.set(false);
    disabledReason = message;
    if (warned.compareAndSet(false, true) && warningSink != null) {
      warningSink.accept(message);
    }
  }
}
