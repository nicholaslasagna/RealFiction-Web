package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.config.RealCoreConfig;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class VaultBalanceSyncServiceTest {
  private static final UUID PLAYER_UUID = UUID.fromString("11111111-1111-1111-1111-111111111111");

  @Test
  void convertsVaultDollarsToMinorUnits() {
    assertEquals(0, VaultBalanceSyncService.toMinorUnits(0.0, 100));
    assertEquals(100, VaultBalanceSyncService.toMinorUnits(1.0, 100));
    assertEquals(25075, VaultBalanceSyncService.toMinorUnits(250.75, 100));
    assertEquals(251, VaultBalanceSyncService.toMinorUnits(2.505, 100));
  }

  @Test
  void convertsMinorUnitsToVaultAmount() {
    assertEquals(1.0, VaultBalanceSyncService.toVaultAmount(100, 100));
    assertEquals(250.75, VaultBalanceSyncService.toVaultAmount(25075, 100));
    assertEquals(0.01, VaultBalanceSyncService.toVaultAmount(1, 100));
  }

  @Test
  void formatsMinorUnitBalancesForOperatorOutput() {
    assertEquals("$0.00", EconomyBalanceFormat.formatMinor(0, 100));
    assertEquals("$1.00", EconomyBalanceFormat.formatMinor(100, 100));
    assertEquals("$250.75", EconomyBalanceFormat.formatMinor(25075, 100));
    assertEquals("$-1.25", EconomyBalanceFormat.formatMinor(-125, 100));
    assertEquals("$-0.25", EconomyBalanceFormat.formatMinor(-25, 100));
  }

  @Test
  void guardRequiresExplicitEnablementAndAllowlist() throws InvalidConfigurationException {
    RealCoreConfig disabled = config("smp-1", "smp", true, false);
    assertEquals("Vault sync from DB is disabled by economy.syncVaultFromDbEnabled=false.",
        VaultBalanceSyncService.guardReason(disabled, true, ""));

    RealCoreConfig wrongBackend = config("factions-1", "factions", true, true);
    assertEquals("server.id is not in economy.syncVaultFromDbBackendAllowlist.",
        VaultBalanceSyncService.guardReason(wrongBackend, true, ""));

    RealCoreConfig allowed = config("smp-1", "smp", true, true);
    assertEquals("", VaultBalanceSyncService.guardReason(allowed, true, ""));
  }

  @Test
  void guardBlocksAnarchyAndRequiresDbReadPath() throws InvalidConfigurationException {
    RealCoreConfig anarchy = config("anarchy-1", "anarchy", true, true);
    assertEquals("Anarchy may not sync the global economy into Vault.",
        VaultBalanceSyncService.guardReason(anarchy, true, ""));

    RealCoreConfig smp = config("smp-1", "smp", true, true);
    assertEquals("DB balance read is unavailable: policy denied",
        VaultBalanceSyncService.guardReason(smp, true, "policy denied"));
  }

  @Test
  void guardRequiresEconomyModuleAndEnabledState() throws InvalidConfigurationException {
    RealCoreConfig moduleOff = config("smp-1", "smp", false, true);
    assertEquals("Global economy is disabled by modules.economy=false.",
        VaultBalanceSyncService.guardReason(moduleOff, true, ""));

    RealCoreConfig smp = config("smp-1", "smp", true, true);
    assertEquals("Global economy is disabled by economy.enabled=false.",
        VaultBalanceSyncService.guardReason(smp, false, ""));
  }

  @Test
  void decidesDepositWithdrawNoopAndDeltaCap() {
    VaultBalanceSyncService.SyncDecision deposit = VaultBalanceSyncService.decide(12_000, 10_000, 5_000);
    assertEquals(VaultBalanceSyncService.SyncAction.DEPOSIT, deposit.action());
    assertEquals(2_000, deposit.deltaMinor());

    VaultBalanceSyncService.SyncDecision withdraw = VaultBalanceSyncService.decide(8_000, 10_000, 5_000);
    assertEquals(VaultBalanceSyncService.SyncAction.WITHDRAW, withdraw.action());
    assertEquals(-2_000, withdraw.deltaMinor());

    assertEquals(VaultBalanceSyncService.SyncAction.NOOP,
        VaultBalanceSyncService.decide(10_000, 10_000, 5_000).action());

    VaultBalanceSyncService.SyncDecision capped = VaultBalanceSyncService.decide(20_000, 10_000, 5_000);
    assertEquals(VaultBalanceSyncService.SyncAction.SKIP, capped.action());
    assertTrue(capped.skipped());
  }

  @Test
  void maxPlayersCapAndReportCountsAreStable() {
    List<VaultBalanceSyncService.Target> targets = List.of(
        new VaultBalanceSyncService.Target(PLAYER_UUID, "Alex", true),
        new VaultBalanceSyncService.Target(UUID.fromString("22222222-2222-2222-2222-222222222222"), "Steve", true)
    );
    assertEquals(1, VaultBalanceSyncService.limitTargets(targets, 1).size());

    VaultBalanceSyncService.SyncResult dryRunDeposit = result(VaultBalanceSyncService.SyncAction.DEPOSIT, 2_000, true, false, false, false);
    VaultBalanceSyncService.SyncResult appliedWithdraw = result(VaultBalanceSyncService.SyncAction.WITHDRAW, -3_000, false, true, false, false);
    VaultBalanceSyncService.SyncResult skipped = result(VaultBalanceSyncService.SyncAction.SKIP, 10_000, true, false, true, false);
    VaultBalanceSyncService.SyncReport report = VaultBalanceSyncService.SyncReport.from(
        "smp-1", "smp", true, List.of(dryRunDeposit, appliedWithdraw, skipped), 1);

    assertEquals(3, report.scanned());
    assertEquals(2, report.wouldUpdate());
    assertEquals(1, report.applied());
    assertEquals(2, report.skipped());
    assertEquals(0, report.failed());
    assertEquals(10_000, report.largestDeltaMinor());
    assertEquals(12_000, report.totalPositiveDeltaMinor());
    assertEquals(-3_000, report.totalNegativeDeltaMinor());
  }

  private static VaultBalanceSyncService.SyncResult result(
      VaultBalanceSyncService.SyncAction action,
      long delta,
      boolean dryRun,
      boolean applied,
      boolean skipped,
      boolean failed
  ) {
    return new VaultBalanceSyncService.SyncResult(
        "smp-1",
        "smp",
        "Vault",
        PLAYER_UUID,
        "Alex",
        "realfiction_main",
        100,
        10_000 + delta,
        10_000,
        applied ? 10_000 + delta : 10_000,
        delta,
        action,
        "",
        dryRun,
        applied,
        skipped,
        failed,
        "console",
        Instant.now()
    );
  }

  private static RealCoreConfig config(String serverId, String serverGroup, boolean moduleEnabled,
                                       boolean syncEnabled) throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        baseUrl: "https://realfiction.test"
        server:
          id: "%s"
          group: "%s"
          displayName: "Test"
        hmacSecret: "test-secret"
        modules:
          economy: %s
        economy:
          enabled: true
          syncVaultFromDbEnabled: %s
          syncVaultFromDbBackendAllowlist:
            - smp-1
          dbBalanceReadEnabled: true
          dbBalanceReadBackendAllowlist:
            - smp-1
        """.formatted(serverId, serverGroup, moduleEnabled, syncEnabled));
    return RealCoreConfig.from(yaml);
  }
}
