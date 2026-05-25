package com.realfiction.realcore.config;

import java.time.Duration;
import java.util.List;
import org.bukkit.configuration.ConfigurationSection;

/**
 * Disabled-by-default global economy client settings.
 *
 * <p>Phase 3 only prepares the RealCore HTTP client/queue foundation. It does
 * not register a Vault provider, mutate EssentialsX balances, or create any
 * gameplay producers.
 */
public record EconomyConfig(
    boolean enabled,
    String currencyKey,
    Duration flushInterval,
    int bufferSize,
    int maxBatchSize,
    Duration balanceCacheTtl,
    boolean dbBalanceReadEnabled,
    List<String> dbBalanceReadBackendAllowlist,
    Duration dbBalanceReadCacheTtl,
    int dbBalanceReadMaxPlayersPerBatch,
    long stagingTestMaxCreditMinor,
    boolean syncVaultAfterDb,
    long syncVaultMaxDeltaMinor,
    boolean voteRewardsToLedger,
    boolean voteRewardsLedgerDryRun,
    boolean voteRewardsLedgerWritesEnabled,
    boolean voteRewardsLedgerFallbackCommands,
    boolean vaultDeltaShadowEnabled,
    Duration vaultDeltaShadowInterval,
    int vaultDeltaShadowMaxPlayersPerRun,
    long vaultDeltaShadowMinDeltaMinor,
    long vaultDeltaShadowMaxLoggedDeltaMinor,
    List<String> vaultDeltaShadowBackendAllowlist,
    ShadowConfig shadow
) {
  public static EconomyConfig disabledDefaults() {
    return new EconomyConfig(
        false,
        "realfiction_main",
        Duration.ofSeconds(30),
        5000,
        100,
        Duration.ofSeconds(30),
        false,
        List.of("smp-1"),
        Duration.ofSeconds(30),
        100,
        100,
        false,
        100,
        false,
        true,
        false,
        true,
        false,
        Duration.ofSeconds(300),
        100,
        1,
        250_000,
        List.of("smp-1"),
        ShadowConfig.defaults()
    );
  }

  public static EconomyConfig from(ConfigurationSection section) {
    EconomyConfig defaults = disabledDefaults();
    if (section == null) {
      return defaults;
    }

    String currencyKey = section.getString("currencyKey", defaults.currencyKey()).trim().toLowerCase(java.util.Locale.ROOT);
    if (!currencyKey.matches("^[a-z0-9_.-]{2,80}$")) {
      throw new IllegalArgumentException("economy.currencyKey must be 2-80 letters, numbers, dots, dashes, or underscores.");
    }

    return new EconomyConfig(
        section.getBoolean("enabled", defaults.enabled()),
        currencyKey,
        Duration.ofSeconds(Math.max(5, section.getLong("flushSeconds", defaults.flushInterval().toSeconds()))),
        Math.max(1, section.getInt("bufferSize", defaults.bufferSize())),
        Math.max(1, Math.min(500, section.getInt("maxBatchSize", defaults.maxBatchSize()))),
        Duration.ofSeconds(Math.max(5, section.getLong("balanceCacheSeconds", defaults.balanceCacheTtl().toSeconds()))),
        section.getBoolean("dbBalanceReadEnabled", defaults.dbBalanceReadEnabled()),
        normalizeAllowlist(section.getStringList("dbBalanceReadBackendAllowlist"), defaults.dbBalanceReadBackendAllowlist()),
        Duration.ofSeconds(Math.max(5, section.getLong(
            "dbBalanceReadCacheSeconds",
            defaults.dbBalanceReadCacheTtl().toSeconds()))),
        Math.max(1, Math.min(500, section.getInt(
            "dbBalanceReadMaxPlayersPerBatch",
            defaults.dbBalanceReadMaxPlayersPerBatch()))),
        Math.max(1, Math.min(10_000, section.getLong("stagingTestMaxCreditMinor", defaults.stagingTestMaxCreditMinor()))),
        section.getBoolean("syncVaultAfterDb", defaults.syncVaultAfterDb()),
        Math.max(1, Math.min(1_000_000, section.getLong("syncVaultMaxDeltaMinor", defaults.syncVaultMaxDeltaMinor()))),
        section.getBoolean("voteRewardsToLedger", defaults.voteRewardsToLedger()),
        section.getBoolean("voteRewardsLedgerDryRun", defaults.voteRewardsLedgerDryRun()),
        section.getBoolean("voteRewardsLedgerWritesEnabled", defaults.voteRewardsLedgerWritesEnabled()),
        section.getBoolean("voteRewardsLedgerFallbackCommands", defaults.voteRewardsLedgerFallbackCommands()),
        section.getBoolean("vaultDeltaShadowEnabled", defaults.vaultDeltaShadowEnabled()),
        Duration.ofSeconds(Math.max(60, section.getLong(
            "vaultDeltaShadowIntervalSeconds",
            defaults.vaultDeltaShadowInterval().toSeconds()))),
        Math.max(1, Math.min(500, section.getInt(
            "vaultDeltaShadowMaxPlayersPerRun",
            defaults.vaultDeltaShadowMaxPlayersPerRun()))),
        Math.max(0, section.getLong(
            "vaultDeltaShadowMinDeltaMinor",
            defaults.vaultDeltaShadowMinDeltaMinor())),
        Math.max(1, section.getLong(
            "vaultDeltaShadowMaxLoggedDeltaMinor",
            defaults.vaultDeltaShadowMaxLoggedDeltaMinor())),
        normalizeAllowlist(section.getStringList("vaultDeltaShadowBackendAllowlist"), defaults.vaultDeltaShadowBackendAllowlist()),
        ShadowConfig.from(section.getConfigurationSection("shadow"), defaults.shadow())
    );
  }

  private static List<String> normalizeAllowlist(List<String> configured, List<String> fallback) {
    List<String> values = configured == null || configured.isEmpty() ? fallback : configured;
    return values.stream()
        .map(value -> value == null ? "" : value.trim().toLowerCase(java.util.Locale.ROOT))
        .filter(value -> !value.isBlank())
        .distinct()
        .toList();
  }

  public record ShadowConfig(
      long warningDeltaMinor,
      long severeDeltaMinor,
      boolean ignoreNegativeOneMinorNoise,
      int repeatedOffenderThreshold,
      int observationCacheSize
  ) {
    public static ShadowConfig defaults() {
      return new ShadowConfig(5_000, 50_000, true, 5, 500);
    }

    public static ShadowConfig from(ConfigurationSection section, ShadowConfig fallback) {
      ShadowConfig defaults = fallback == null ? defaults() : fallback;
      if (section == null) {
        return defaults;
      }
      long warning = Math.max(1, section.getLong("warningDeltaMinor", defaults.warningDeltaMinor()));
      long severe = Math.max(warning, section.getLong("severeDeltaMinor", defaults.severeDeltaMinor()));
      return new ShadowConfig(
          warning,
          severe,
          section.getBoolean("ignoreNegativeOneMinorNoise", defaults.ignoreNegativeOneMinorNoise()),
          Math.max(1, section.getInt("repeatedOffenderThreshold", defaults.repeatedOffenderThreshold())),
          Math.max(10, Math.min(10_000, section.getInt("observationCacheSize", defaults.observationCacheSize())))
      );
    }
  }
}
