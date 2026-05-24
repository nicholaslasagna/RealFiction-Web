package com.realfiction.realcore.economy;

import java.util.Locale;

public enum EconomyCategory {
  VOTE_REWARD("vote_reward"),
  GAMEPLAY_EARN("gameplay_earn"),
  SPEND("spend");

  private final String apiValue;

  EconomyCategory(String apiValue) {
    this.apiValue = apiValue;
  }

  public String apiValue() {
    return apiValue;
  }

  public boolean credit() {
    return this == VOTE_REWARD || this == GAMEPLAY_EARN;
  }

  public static EconomyCategory fromApiValue(String value) {
    String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    for (EconomyCategory category : values()) {
      if (category.apiValue.equals(normalized)) {
        return category;
      }
    }
    throw new IllegalArgumentException("Unsupported economy category: " + value);
  }
}
