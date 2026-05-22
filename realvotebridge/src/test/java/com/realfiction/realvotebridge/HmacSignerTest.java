package com.realfiction.realvotebridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

final class HmacSignerTest {
  @Test
  void signsWebsiteCompatibleMessage() {
    String body = "{\"site\":\"MinecraftServers.org\",\"minecraftUsername\":\"RealPlayer\"}";
    String message = HmacSigner.signedMessage("velocity", 1234L, "abc", "POST", "/api/vote", body);

    assertEquals("velocity.1234.abc.POST./api/vote." + body, message);
    assertEquals(
        "9dc76add286e1a7cbe2944edfe1ad65bc2de8da24eb6084a59c5bb6da4b2fb0a",
        HmacSigner.sign("secret", message)
    );
  }

  @Test
  void generatesLongVoteTokenHash() {
    assertTrue(HmacSigner.sha256("vote").length() >= 64);
  }
}
