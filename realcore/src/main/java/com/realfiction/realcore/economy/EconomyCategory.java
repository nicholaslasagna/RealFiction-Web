package com.realfiction.realcore.economy;

import java.util.Locale;

public enum EconomyCategory {
  VOTE_REWARD("vote_reward"),
  GAMEPLAY_EARN("gameplay_earn"),
  GAMEPLAY_SPEND("gameplay_spend"),
  SHOP_SELL("shop_sell"),
  SHOP_BUY("shop_buy"),
  SPEND("spend");

  private final String apiValue;

  EconomyCategory(String apiValue) {
    this.apiValue = apiValue;
  }

  public String apiValue() {
    return apiValue;
  }

  public boolean credit() {
    return this == VOTE_REWARD || this == GAMEPLAY_EARN || this == SHOP_SELL;
  }

  public boolean debit() {
    return this == SPEND || this == GAMEPLAY_SPEND || this == SHOP_BUY;
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
