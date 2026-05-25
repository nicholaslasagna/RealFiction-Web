package com.realfiction.realcore.config;

import com.realfiction.realcore.economy.EconomyCategory;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import org.bukkit.configuration.ConfigurationSection;

public record RewardEconomyConfig(Map<String, Mapping> byRewardKey) {
  public static RewardEconomyConfig empty() {
    return new RewardEconomyConfig(Map.of());
  }

  public static RewardEconomyConfig from(ConfigurationSection section) {
    if (section == null) {
      return empty();
    }
    ConfigurationSection byRewardKey = section.getConfigurationSection("byRewardKey");
    if (byRewardKey == null) {
      return empty();
    }

    Map<String, Mapping> values = new LinkedHashMap<>();
    readMappings(byRewardKey, "", values);
    return new RewardEconomyConfig(Collections.unmodifiableMap(values));
  }

  private static void readMappings(
      ConfigurationSection section, String prefix, Map<String, Mapping> values) {
    for (String key : section.getKeys(false)) {
      ConfigurationSection child = section.getConfigurationSection(key);
      if (child == null) {
        continue;
      }

      String rewardKey = prefix.isBlank() ? key : prefix + "." + key;
      if (child.contains("amountMinor")
          || child.contains("currencyKey")
          || child.contains("category")) {
        values.put(rewardKey, Mapping.from(child));
        continue;
      }

      readMappings(child, rewardKey, values);
    }
  }

  public record Mapping(long amountMinor, String currencyKey, EconomyCategory category) {
    static Mapping from(ConfigurationSection section) {
      long amountMinor = section.getLong("amountMinor", 0);
      if (amountMinor <= 0) {
        throw new IllegalArgumentException("rewards.economy.byRewardKey amountMinor must be positive.");
      }

      String currencyKey = section.getString("currencyKey", "realfiction_main");
      currencyKey = currencyKey == null ? "realfiction_main" : currencyKey.trim().toLowerCase(Locale.ROOT);
      if (!currencyKey.matches("^[a-z0-9_.-]{2,80}$")) {
        throw new IllegalArgumentException("rewards.economy.byRewardKey currencyKey is invalid.");
      }

      EconomyCategory category = EconomyCategory.fromApiValue(section.getString("category", "vote_reward"));
      if (!category.credit()) {
        throw new IllegalArgumentException("rewards.economy.byRewardKey category must be a credit category.");
      }

      return new Mapping(amountMinor, currencyKey, category);
    }
  }
}
