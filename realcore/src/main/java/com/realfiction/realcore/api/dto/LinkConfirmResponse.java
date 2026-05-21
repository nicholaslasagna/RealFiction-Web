package com.realfiction.realcore.api.dto;

public final class LinkConfirmResponse {
  public boolean confirmed;
  public Link link;
  public String error;

  public static final class Link {
    public String minecraftUuid;
    public String minecraftUsername;
    public String platform;
  }
}
