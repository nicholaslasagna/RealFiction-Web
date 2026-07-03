package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

final class VaultReconcileRuntimeGuardTest {
  @Test
  void missingVaultDisablesReconcileAndWarnsOnce() {
    VaultReconcileRuntimeGuard guard = new VaultReconcileRuntimeGuard();
    List<String> warnings = new ArrayList<>();

    assertTrue(guard.enabled());
    guard.disableVaultUnavailable(warnings::add);

    assertFalse(guard.enabled());
    assertTrue(guard.disabled());
    assertEquals(VaultReconcileRuntimeGuard.VAULT_UNAVAILABLE_REASON, guard.disabledReason());
    assertEquals(1, warnings.size());

    guard.disableVaultUnavailable(warnings::add);
    assertEquals(1, warnings.size(), "missing Vault must disable reconcile without repeated WARN spam");
  }
}
