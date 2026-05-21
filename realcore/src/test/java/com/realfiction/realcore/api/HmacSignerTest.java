package com.realfiction.realcore.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import org.junit.jupiter.api.Test;

final class HmacSignerTest {
  @Test
  void signsWithStandardHmacSha256() {
    String signature = HmacSigner.sign("key", "The quick brown fox jumps over the lazy dog");

    assertEquals("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8", signature);
  }

  @Test
  void buildsWebsiteCompatibleSignedMessage() {
    String body = "{\"serverId\":\"lobby-1\",\"limit\":25}";

    String message = HmacSigner.signedMessage(
        "lobby-1",
        1779300000000L,
        "abc123",
        "post",
        "/api/plugin/rewards/poll",
        body
    );

    assertEquals(
        "lobby-1.1779300000000.abc123.POST./api/plugin/rewards/poll.{\"serverId\":\"lobby-1\",\"limit\":25}",
        message
    );
  }

  @Test
  void nonceIsRandomHex() {
    String first = HmacSigner.nonce();
    String second = HmacSigner.nonce();

    assertEquals(48, first.length());
    assertEquals(48, second.length());
    assertNotEquals(first, second);
  }
}
