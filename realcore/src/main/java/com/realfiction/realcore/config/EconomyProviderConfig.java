package com.realfiction.realcore.config;

import java.util.List;
import java.util.Locale;
import org.bukkit.configuration.ConfigurationSection;

/**
 * Disabled-by-default settings for making RealCore the network's Vault economy provider, backed by
 * the shared Supabase {@code economy_balances} store.
 *
 * <p><b>Staged.</b> {@code shadowMode} (default true) means RealCore only <em>observes</em> — it
 * preloads each player's authoritative balance and logs it next to the current Vault/EssentialsX
 * balance, without registering as the provider or moving any money. Only when {@code enabled} is
 * true, {@code shadowMode} is false, and this server's id is on {@code backendAllowlist} does
 * RealCore actually become the economy.
 */
public record EconomyProviderConfig(
    boolean enabled,
    boolean shadowMode,
    List<String> backendAllowlist,
    boolean failClosed,
    int cacheTtlSeconds,
    int maxCachedAccounts,
    String currencyNameSingular,
    String currencyNamePlural,
    String currencySymbol,
    int fractionalDigits
) {
  public static EconomyProviderConfig disabledDefaults() {
    return new EconomyProviderConfig(
        false,
        true,
        List.of(),
        true,
        0,
        20_000,
        "dollar",
        "dollars",
        "$",
        2
    );
  }

  public static EconomyProviderConfig from(ConfigurationSection section) {
    EconomyProviderConfig defaults = disabledDefaults();
    if (section == null) {
      return defaults;
    }
    return new EconomyProviderConfig(
        section.getBoolean("enabled", defaults.enabled()),
        section.getBoolean("shadowMode", defaults.shadowMode()),
        normalizeAllowlist(section.getStringList("backendAllowlist")),
        section.getBoolean("failClosed", defaults.failClosed()),
        Math.max(0, Math.min(86_400, section.getInt("cacheTtlSeconds", defaults.cacheTtlSeconds()))),
        Math.max(64, Math.min(1_000_000, section.getInt("maxCachedAccounts", defaults.maxCachedAccounts()))),
        cleanText(section.getString("currencyNameSingular"), defaults.currencyNameSingular()),
        cleanText(section.getString("currencyNamePlural"), defaults.currencyNamePlural()),
        cleanText(section.getString("currencySymbol"), defaults.currencySymbol()),
        Math.max(0, Math.min(4, section.getInt("fractionalDigits", defaults.fractionalDigits())))
    );
  }

  private static String cleanText(String value, String fallback) {
    if (value == null) {
      return fallback;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? fallback : trimmed;
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

  /** True when this server id is on the provider allowlist. */
  public boolean allows(String serverId) {
    String id = serverId == null ? "" : serverId.trim().toLowerCase(Locale.ROOT);
    return !id.isBlank() && backendAllowlist.contains(id);
  }

  /** The scale (minor units per major unit) implied by {@link #fractionalDigits()} — e.g. 2 -> 100. */
  public int scale() {
    int s = 1;
    for (int i = 0; i < fractionalDigits(); i++) {
      s *= 10;
    }
    return s;
  }
}
