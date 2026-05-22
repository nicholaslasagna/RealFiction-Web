package com.realfiction.realvotebridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

final class BridgeConfigTest {
  @Test
  void parsesFlatYamlConfig() {
    BridgeConfig config = BridgeConfig.parse("""
        enabled: true
        baseUrl: "https://realfiction.live"
        serverId: "velocity"
        hmacSecret: "super-secret"
        requestTimeoutSeconds: 7
        debug: true
        """);

    assertTrue(config.ready());
    assertEquals("velocity", config.serverId());
    assertEquals("https://realfiction.live", config.baseUrl().toString());
    assertEquals(7, config.requestTimeout().toSeconds());
    assertTrue(config.debug());
  }

  @Test
  void changeMeSecretIsNotReady() {
    BridgeConfig config = BridgeConfig.parse("""
        enabled: true
        baseUrl: "https://realfiction.live"
        serverId: "velocity"
        hmacSecret: "CHANGE_ME"
        """);

    assertFalse(config.ready());
  }
}
