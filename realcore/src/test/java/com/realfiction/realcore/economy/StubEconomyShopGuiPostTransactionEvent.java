package com.realfiction.realcore.economy;

import java.util.Map;
import java.util.UUID;
import org.bukkit.entity.Player;

/** Minimal stand-in for EconomyShopGUI PostTransactionEvent in unit tests. */
final class StubEconomyShopGuiPostTransactionEvent {
  private final String transactionType;
  private final String transactionResult;
  private final Player player;
  private final double price;
  private final Map<?, ?> prices;
  private final Object shopItem;
  private final double amount;

  StubEconomyShopGuiPostTransactionEvent(
      String transactionType,
      String transactionResult,
      Player player,
      double price
  ) {
    this(transactionType, transactionResult, player, price, Map.of(), null, 1);
  }

  StubEconomyShopGuiPostTransactionEvent(
      String transactionType,
      String transactionResult,
      Player player,
      double price,
      Map<?, ?> prices,
      Object shopItem,
      double amount
  ) {
    this.transactionType = transactionType;
    this.transactionResult = transactionResult;
    this.player = player;
    this.price = price;
    this.prices = prices;
    this.shopItem = shopItem;
    this.amount = amount;
  }

  public String getTransactionType() {
    return transactionType;
  }

  public String getTransactionResult() {
    return transactionResult;
  }

  public Player getPlayer() {
    return player;
  }

  public double getPrice() {
    return price;
  }

  public Map<?, ?> getPrices() {
    return prices;
  }

  public Object getShopItem() {
    return shopItem;
  }

  public double getAmount() {
    return amount;
  }

  static Object shopItemWithPath(String path) {
    return new Object() {
      @SuppressWarnings("unused")
      public String getItemPath() {
        return path;
      }
    };
  }
}
