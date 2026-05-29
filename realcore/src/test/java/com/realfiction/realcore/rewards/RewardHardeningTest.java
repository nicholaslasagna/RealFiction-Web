package com.realfiction.realcore.rewards;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.api.dto.AckRewardsRequest;
import com.realfiction.realcore.api.dto.RewardPayload;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.cosmetics.CosmeticEntitlements;
import com.realfiction.realcore.cosmetics.CosmeticsConstants;
import java.util.List;
import java.util.logging.Logger;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class RewardHardeningTest {
  @TempDir
  java.nio.file.Path tempDir;

  @Test
  void ledgerPreventsDuplicateDelivery() throws Exception {
    RewardLedger ledger = new RewardLedger(tempDir.resolve("ledger.log"), Logger.getLogger("test"));
    ledger.load();
    assertFalse(ledger.wasDelivered("reward-1"));
    ledger.markDelivered("reward-1");
    assertTrue(ledger.wasDelivered("reward-1"));
    ledger.markDelivered("reward-1");
    assertEquals(1, ledger.size());
  }

  @Test
  void failedDeliveryAckStatusIsFailed() {
    RewardDeliveryResult failed = RewardDeliveryResult.failed("id-1", "boom");
    AckRewardsRequest.Delivery ack = failed.toAckDelivery();
    assertEquals("failed", ack.status);
    assertEquals("boom", ack.failureReason);
  }

  @Test
  void successfulDeliveryAcksDeliveredOnce() {
    RewardDeliveryResult ok = RewardDeliveryResult.delivered("id-2");
    AckRewardsRequest.Delivery ack = ok.toAckDelivery();
    assertEquals("delivered", ack.status);
    assertTrue(ack.failureReason == null || ack.failureReason.isBlank());
  }

  @Test
  void builtinSlugMapsToPetsPermission() throws InvalidConfigurationException {
    RealCoreConfig config = configWithMappings();
    RewardPayload reward = rewardWithSlug("realpets-pack");
    ProductPermissionResolver.ResolveResult result =
        ProductPermissionResolver.resolve(config, reward, null);
    assertTrue(result.hasPermission());
    assertEquals(CosmeticsConstants.PERM_PETS, result.permission());
    assertEquals(ProductPermissionResolver.Source.BUILTIN, result.source());
  }

  @Test
  void subscriptionTierUsesLuckPermsPermissionFallback() throws InvalidConfigurationException {
    RealCoreConfig config = configWithMappings();
    RewardPayload reward = rewardWithSlug("realvip-monthly");
    reward.delivery.luckPerms = new RewardPayload.LuckPermsPayload();
    reward.delivery.luckPerms.permission = "group.realvip";
    ProductPermissionResolver.ResolveResult result =
        ProductPermissionResolver.resolve(config, reward, null);
    assertEquals("group.realvip", result.permission());
    assertEquals(ProductPermissionResolver.Source.PAYLOAD_LUCKPERMS, result.source());
  }

  @Test
  void unknownSlugHasNoPermission() throws InvalidConfigurationException {
    RealCoreConfig config = configWithMappings();
    RewardPayload reward = rewardWithSlug("totally-new-product");
    ProductPermissionResolver.ResolveResult result =
        ProductPermissionResolver.resolve(config, reward, null);
    assertFalse(result.hasPermission());
    assertEquals(ProductPermissionResolver.Source.UNKNOWN, result.source());
  }

  @Test
  void unsafeCommandBlockedWhenUnsafeRewardsDisabled() throws InvalidConfigurationException {
    RealCoreConfig config = configWithMappings();
    RewardPayload reward = rewardWithSlug(null);
    RewardCommandSafety.SafetyResult result = RewardCommandSafety.validateCommands(
        config,
        reward,
        List.of("op {player}")
    );
    assertFalse(result.allowed());
    assertNotNull(result.reason());
  }

  @Test
  void safeEcoGiveAllowed() throws InvalidConfigurationException {
    RealCoreConfig config = configWithMappings();
    RewardPayload reward = rewardWithSlug(null);
    RewardCommandSafety.SafetyResult result = RewardCommandSafety.validateCommands(
        config,
        reward,
        List.of("eco give {player} 250")
    );
    assertTrue(result.allowed());
    assertEquals(1, result.commands().size());
  }

  @Test
  void commandInjectionInUsernameBlocked() throws InvalidConfigurationException {
    RealCoreConfig config = configWithMappings();
    RewardPayload reward = rewardWithSlug(null);
    reward.target.minecraftUsername = "Alex; op Notch";
    RewardCommandSafety.SafetyResult result = RewardCommandSafety.validateCommands(
        config,
        reward,
        List.of("eco give {player} 250")
    );
    assertTrue(result.allowed());
    assertTrue(result.commands().get(0).contains("11111111"));
  }

  @Test
  void cosmeticPermissionCatalogCoversStoreProducts() {
    assertTrue(CosmeticEntitlements.isCosmeticPermission(CosmeticsConstants.PERM_PETS));
    assertTrue(CosmeticEntitlements.isCosmeticPermission(CosmeticsConstants.PERM_ATELIER));
    assertTrue(CosmeticEntitlements.isCosmeticPermission(CosmeticsConstants.PERM_US250_FOUNDER));
  }

  private static RealCoreConfig configWithMappings() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        baseUrl: "https://realfiction.test"
        server:
          id: "lobby-1"
          group: "lobby"
        hmacSecret: "test-secret"
        rewards:
          allowUnsafeRewards: false
          productPermissions:
            lobby-flight: "realfiction.lobby.flight"
          commands:
            byRewardKey:
              vote.standard:
                - "eco give {player} 250"
        cosmetics:
          options:
            pets:
              fox-friend:
                name: "&6Fox"
                permission: "realfiction.pets.pack"
        """);
    return RealCoreConfig.from(yaml);
  }

  private static RewardPayload rewardWithSlug(String slug) {
    RewardPayload reward = new RewardPayload();
    reward.id = "reward-test";
    reward.rewardKey = "store.test";
    reward.target = new RewardPayload.Target();
    reward.target.minecraftUuid = "11111111-1111-1111-1111-111111111111";
    reward.target.minecraftUsername = "Alex";
    reward.delivery = new RewardPayload.Delivery();
    reward.delivery.safeReward = true;
    reward.delivery.productSlug = slug;
    return reward;
  }
}
