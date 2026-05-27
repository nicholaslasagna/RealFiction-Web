package com.realfiction.realcore.economy;

import com.realfiction.realcore.config.GameplayEconomySyncConfig;

/**
 * Gameplay economy categories accepted by the Phase 8 buffer.
 *
 * <p>Vote rewards use {@link VoteRewardLedgerWriteService} and are intentionally
 * excluded from this enum.
 */
public enum GameplayEconomyCategory {
  GAMEPLAY_EARN(EconomyCategory.GAMEPLAY_EARN, true),
  GAMEPLAY_SPEND(EconomyCategory.GAMEPLAY_SPEND, false),
  SHOP_SELL(EconomyCategory.SHOP_SELL, true),
  SHOP_BUY(EconomyCategory.SHOP_BUY, false);

  private final EconomyCategory ledgerCategory;
  private final boolean credit;

  GameplayEconomyCategory(EconomyCategory ledgerCategory, boolean credit) {
    this.ledgerCategory = ledgerCategory;
    this.credit = credit;
  }

  public EconomyCategory ledgerCategory() {
    return ledgerCategory;
  }

  public boolean credit() {
    return credit;
  }

  public boolean enabledBy(GameplayEconomySyncConfig config) {
    return config.categoryEnabled(this);
  }
}
