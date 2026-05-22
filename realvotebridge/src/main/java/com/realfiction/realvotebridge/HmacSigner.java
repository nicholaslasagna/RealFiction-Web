package com.realfiction.realvotebridge;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class HmacSigner {
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final HexFormat HEX = HexFormat.of();

  private HmacSigner() {
  }

  public static String nonce() {
    byte[] bytes = new byte[24];
    RANDOM.nextBytes(bytes);
    return HEX.formatHex(bytes);
  }

  public static String signedMessage(String serverId, long timestamp, String nonce, String method, String path, String rawBody) {
    return serverId
        + "."
        + timestamp
        + "."
        + nonce
        + "."
        + method.toUpperCase()
        + "."
        + path
        + "."
        + rawBody;
  }

  public static String sign(String secret, String message) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      return HEX.formatHex(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception error) {
      throw new IllegalStateException("Could not sign RealVoteBridge request.", error);
    }
  }

  public static String sha256(String value) {
    try {
      java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
      return HEX.formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception error) {
      throw new IllegalStateException("Could not hash vote token.", error);
    }
  }
}
