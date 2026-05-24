package com.realfiction.realcore.api.dto;

public final class EconomyBalanceRequest {
  public final String serverId;
  public final String serverGroup;
  public final String currencyKey;
  public final String minecraftUuid;

  public EconomyBalanceRequest(String serverId, String serverGroup, String currencyKey, String minecraftUuid) {
    this.serverId = serverId;
    this.serverGroup = serverGroup;
    this.currencyKey = currencyKey;
    this.minecraftUuid = minecraftUuid;
  }
}
