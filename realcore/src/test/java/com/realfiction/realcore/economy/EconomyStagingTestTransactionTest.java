package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.realfiction.realcore.config.RealCoreConfig;
import java.util.UUID;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

final class EconomyStagingTestTransactionTest {
  private static final UUID PLAYER_UUID = UUID.fromString("00000000-0000-0000-0000-000000000123");

  @Test
  void createsBoundedGameplayEarnWithStableIdempotencyKey() throws InvalidConfigurationException {
    RealCoreConfig config = config("smp", true, 100);

    EconomyTransaction first = EconomyStagingTestTransaction.create(config, PLAYER_UUID, "Alex", 100, "Smoke-Test-1");
    EconomyTransaction second = EconomyStagingTestTransaction.create(config, PLAYER_UUID, "Alex", 100, "smoke-test-1");

    assertEquals(EconomyCategory.GAMEPLAY_EARN, first.category());
    assertEquals(100, first.amountMinor());
    assertEquals("realcore-staging-test", first.externalRefType());
    assertEquals("smoke-test-1", first.externalRefId());
    assertEquals(first.idempotencyKey(), second.idempotencyKey());
  }

  @Test
  void refusesWhenEconomyDisabledOrAnarchy() throws InvalidConfigurationException {
    assertThrows(IllegalStateException.class, () ->
        EconomyStagingTestTransaction.create(config("smp", false, 100), PLAYER_UUID, "Alex", 100, "smoke-test-1"));
    assertThrows(IllegalStateException.class, () ->
        EconomyStagingTestTransaction.create(config("anarchy", true, 100), PLAYER_UUID, "Alex", 100, "smoke-test-1"));
  }

  @Test
  void refusesAmountsOutsideConfiguredLimitAndBadTestIds() throws InvalidConfigurationException {
    RealCoreConfig config = config("smp", true, 100);

    assertThrows(IllegalArgumentException.class, () ->
        EconomyStagingTestTransaction.create(config, PLAYER_UUID, "Alex", 0, "smoke-test-1"));
    assertThrows(IllegalArgumentException.class, () ->
        EconomyStagingTestTransaction.create(config, PLAYER_UUID, "Alex", 101, "smoke-test-1"));
    assertThrows(IllegalArgumentException.class, () ->
        EconomyStagingTestTransaction.create(config, PLAYER_UUID, "Alex", 100, "bad id!"));
  }

  private static RealCoreConfig config(String serverGroup, boolean economyEnabled, long testMaxMinor)
      throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        baseUrl: "https://realfiction.test"
        server:
          id: "smp-1"
          group: "%s"
          displayName: "SMP 1"
        hmacSecret: "test-secret"
        modules:
          economy: true
        economy:
          enabled: %s
          stagingTestMaxCreditMinor: %d
        """.formatted(serverGroup, economyEnabled, testMaxMinor));
    return RealCoreConfig.from(yaml);
  }
}
