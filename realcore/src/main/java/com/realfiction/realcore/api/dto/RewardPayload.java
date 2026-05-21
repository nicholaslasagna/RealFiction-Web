package com.realfiction.realcore.api.dto;

public final class RewardPayload {
  public String id;
  public String source;
  public String rewardKey;
  public String rewardType;
  public String serverGroup;
  public int attempts;
  public Target target;
  public Entitlement entitlement;
  public Delivery delivery;
  public Timing timing;

  public String minecraftUuid() {
    return target == null ? null : target.minecraftUuid;
  }

  public String minecraftUsername() {
    return target == null ? null : target.minecraftUsername;
  }

  public String action() {
    return delivery == null || delivery.action == null ? "grant" : delivery.action;
  }

  public static final class Target {
    public String minecraftUuid;
    public String minecraftUsername;
  }

  public static final class Entitlement {
    public String key;
    public String status;
    public String expiresAt;
  }

  public static final class Delivery {
    public String action;
    public boolean safeReward;
    public String productSlug;
    public String voteSite;
    public int quantity = 1;
    public Integer durationDays;
    public LuckPermsPayload luckPerms;
    public CosmeticPayload cosmetic;
    public GiftCardPayload giftCard;
  }

  public static final class LuckPermsPayload {
    public String group;
    public String permission;
    public String prefix;
    public String suffix;
  }

  public static final class CosmeticPayload {
    public String type;
    public String key;
    public boolean lobbyOnly;
  }

  public static final class GiftCardPayload {
    public Integer valueCents;
  }

  public static final class Timing {
    public String availableAt;
    public String processingAt;
    public String claimedAt;
    public String claimedByServer;
  }
}
