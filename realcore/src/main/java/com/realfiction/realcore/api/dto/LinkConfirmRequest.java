package com.realfiction.realcore.api.dto;

public final class LinkConfirmRequest {
  public final String serverId;
  public final String verificationCode;
  public final String minecraftUuid;
  public final String minecraftUsername;
  public final String platform;

  public LinkConfirmRequest(String serverId, String verificationCode, String minecraftUuid, String minecraftUsername, String platform) {
    this.serverId = serverId;
    this.verificationCode = verificationCode;
    this.minecraftUuid = minecraftUuid;
    this.minecraftUsername = minecraftUsername;
    this.platform = platform;
  }
}
