package com.realfiction.realcore.api;

public final class PlatformApiException extends RuntimeException {
  private final int statusCode;

  public PlatformApiException(String message, int statusCode) {
    super(message);
    this.statusCode = statusCode;
  }

  public int statusCode() {
    return statusCode;
  }
}
