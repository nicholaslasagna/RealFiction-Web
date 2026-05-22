package com.realfiction.realvotebridge;

import java.time.Instant;

public record VotePayload(
    String site,
    String minecraftUsername,
    Instant votedAt,
    String address
) {
  public String voteToken() {
    String raw = site + "|" + minecraftUsername.toLowerCase() + "|" + votedAt.toEpochMilli() + "|" + (address == null ? "" : address);
    return HmacSigner.sha256(raw);
  }

  public String toJson() {
    StringBuilder builder = new StringBuilder();
    builder.append('{')
        .append("\"site\":\"").append(json(site)).append("\",")
        .append("\"minecraftUsername\":\"").append(json(minecraftUsername)).append("\",")
        .append("\"voteToken\":\"").append(voteToken()).append("\",")
        .append("\"votedAt\":\"").append(json(votedAt.toString())).append("\"");
    if (address != null && !address.isBlank()) {
      builder.append(",\"address\":\"").append(json(address)).append("\"");
    }
    builder.append('}');
    return builder.toString();
  }

  private static String json(String value) {
    StringBuilder builder = new StringBuilder();
    for (int index = 0; index < value.length(); index++) {
      char character = value.charAt(index);
      switch (character) {
        case '"' -> builder.append("\\\"");
        case '\\' -> builder.append("\\\\");
        case '\b' -> builder.append("\\b");
        case '\f' -> builder.append("\\f");
        case '\n' -> builder.append("\\n");
        case '\r' -> builder.append("\\r");
        case '\t' -> builder.append("\\t");
        default -> {
          if (character < 0x20) {
            builder.append(String.format("\\u%04x", (int) character));
          } else {
            builder.append(character);
          }
        }
      }
    }
    return builder.toString();
  }
}
