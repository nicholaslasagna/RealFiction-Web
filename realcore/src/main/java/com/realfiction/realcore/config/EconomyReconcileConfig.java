package com.realfiction.realcore.config;

import java.util.List;
import java.util.Locale;
import org.bukkit.configuration.ConfigurationSection;

/**
 * Disabled-by-default settings for continuous DB-to-Vault balance reconciliation.
 *
 * <p>This block powers {@code EconomyReconciliationService}, which keeps a backend's local
 * Vault/EssentialsX balance aligned with the authoritative global DB balance (the value the
 * website leaderboard reads). It is <b>pull-only</b>: it deposits/withdraws into the local Vault
 * to match the DB and never writes the economy ledger.
 *
 * <p>Reconciliation is only effective when the DB read path is also enabled
 * ({@code economy.enabled} + {@code economy.dbBalanceReadEnabled} with this server's id in
 * {@code economy.dbBalanceReadBackendAllowlist}). Anarchy is always excluded upstream.
 */
public record EconomyReconcileConfig(
    boolean enabled,
    List<String> backendAllowlist,
    boolean onJoin,
    int joinDelayTicks,
    int periodicSeconds,
    int maxPlayersPerRun,
    long maxDeltaMinor,
    boolean requireOnline,
    boolean dryRun
) {
  public static EconomyReconcileConfig disabledDefaults() {
    return new EconomyReconcileConfig(
        false,
        List.of(),
        true,
        60,
        180,
        25,
        100_000_000L,
        true,
        true
    );
  }

  public static EconomyReconcileConfig from(ConfigurationSection section) {
    EconomyReconcileConfig defaults = disabledDefaults();
    if (section == null) {
      return defaults;
    }
    return new EconomyReconcileConfig(
        section.getBoolean("enabled", defaults.enabled()),
        normalizeAllowlist(section.getStringList("backendAllowlist")),
        section.getBoolean("onJoin", defaults.onJoin()),
        Math.max(0, Math.min(20 * 60 * 5, section.getInt("joinDelayTicks", defaults.joinDelayTicks()))),
        Math.max(0, Math.min(86_400, section.getInt("periodicSeconds", defaults.periodicSeconds()))),
        Math.max(1, Math.min(200, section.getInt("maxPlayersPerRun", defaults.maxPlayersPerRun()))),
        Math.max(1L, Math.min(1_000_000_000_000L, section.getLong("maxDeltaMinor", defaults.maxDeltaMinor()))),
        section.getBoolean("requireOnline", defaults.requireOnline()),
        section.getBoolean("dryRun", defaults.dryRun())
    );
  }

  private static List<String> normalizeAllowlist(List<String> configured) {
    if (configured == null) {
      return List.of();
    }
    return configured.stream()
        .map(value -> value == null ? "" : value.trim().toLowerCase(Locale.ROOT))
        .filter(value -> !value.isBlank())
        .distinct()
        .toList();
  }

  /** True when the given server id is on the reconcile allowlist. */
  public boolean allows(String serverId) {
    String id = serverId == null ? "" : serverId.trim().toLowerCase(Locale.ROOT);
    return !id.isBlank() && backendAllowlist.contains(id);
  }
}
