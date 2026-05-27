package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.UUID;
import org.junit.jupiter.api.Test;

final class GameplayEconomyEventTest {
  private static final UUID PLAYER = UUID.fromString("00000000-0000-0000-0000-000000000123");

  @Test
  void rejectsShopSellCategory() {
    assertThrows(IllegalArgumentException.class, () -> GameplayEconomyEvent.create(
        PLAYER, "Alex", 10, GameplayEconomyCategory.SHOP_SELL, "src", "id", "reason"));
  }

  @Test
  void rejectsShopBuyCategory() {
    assertThrows(IllegalArgumentException.class, () -> GameplayEconomyEvent.create(
        PLAYER, "Alex", 10, GameplayEconomyCategory.SHOP_BUY, "src", "id", "reason"));
  }

  @Test
  void acceptsGameplayEarn() {
    GameplayEconomyEvent event = GameplayEconomyEvent.create(
        PLAYER, "Alex", 100, GameplayEconomyCategory.GAMEPLAY_EARN, "RealCoreQuests", "q-1", "daily");
    assertEquals(GameplayEconomyCategory.GAMEPLAY_EARN, event.category());
  }
}
