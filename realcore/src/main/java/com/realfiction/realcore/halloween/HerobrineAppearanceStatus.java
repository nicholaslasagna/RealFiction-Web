package com.realfiction.realcore.halloween;

public record HerobrineAppearanceStatus(
    String requestedMode,
    String activeBackend,
    boolean protocolLibDetected,
    boolean protocolLibSupported,
    String fallbackReason,
    int activePacketSessions,
    String skinStatus,
    String packetMovementStatus
) {
  public static HerobrineAppearanceStatus unavailable(String requestedMode, String fallbackReason) {
    return new HerobrineAppearanceStatus(
        clean(requestedMode, HerobrineAppearanceConfig.MODE_ARMOR_STAND),
        HerobrineAppearanceConfig.MODE_ARMOR_STAND,
        false,
        false,
        clean(fallbackReason, "ProtocolLib not detected"),
        0,
        "unresolved",
        "unavailable"
    );
  }

  public String summary() {
    return "requestedAppearance=" + requestedMode
        + ", activeAppearance=" + activeBackend
        + ", protocolLibDetected=" + protocolLibDetected
        + ", protocolLibSupported=" + protocolLibSupported
        + ", activePacketSessions=" + activePacketSessions
        + ", fallbackReason=" + clean(fallbackReason, "none")
        + ", skin=" + clean(skinStatus, "unresolved")
        + ", packetMovement=" + clean(packetMovementStatus, "unavailable");
  }

  private static String clean(String value, String fallback) {
    String cleaned = value == null ? "" : value.trim();
    return cleaned.isBlank() ? fallback : cleaned;
  }
}
