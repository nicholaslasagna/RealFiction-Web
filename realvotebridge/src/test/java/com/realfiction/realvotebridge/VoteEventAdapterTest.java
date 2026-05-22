package com.realfiction.realvotebridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

final class VoteEventAdapterTest {
  private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-05-21T20:00:00Z"), ZoneOffset.UTC);

  @Test
  void readsNuVotifierLikeEvent() {
    FakeEvent event = new FakeEvent(new FakeVote("RealPlayer", "Minecraft-MP.com", "10.0.0.5", "1760000000"));

    VotePayload payload = VoteEventAdapter.fromEvent(event, CLOCK).orElseThrow();

    assertEquals("RealPlayer", payload.minecraftUsername());
    assertEquals("Minecraft-MP.com", payload.site());
    assertEquals("10.0.0.5", payload.address());
    assertEquals(Instant.ofEpochSecond(1760000000L), payload.votedAt());
    assertTrue(payload.toJson().contains("\"voteToken\""));
  }

  @Test
  void fallsBackToCurrentTimeWhenTimestampIsMissing() {
    FakeEvent event = new FakeEvent(new FakeVote("RealPlayer", "TopG.org", null, null));

    VotePayload payload = VoteEventAdapter.fromEvent(event, CLOCK).orElseThrow();

    assertEquals(Instant.now(CLOCK), payload.votedAt());
  }

  public static final class FakeEvent {
    private final FakeVote vote;

    FakeEvent(FakeVote vote) {
      this.vote = vote;
    }

    public FakeVote getVote() {
      return vote;
    }
  }

  public static final class FakeVote {
    private final String username;
    private final String serviceName;
    private final String address;
    private final String timestamp;

    FakeVote(String username, String serviceName, String address, String timestamp) {
      this.username = username;
      this.serviceName = serviceName;
      this.address = address;
      this.timestamp = timestamp;
    }

    public String getUsername() {
      return username;
    }

    public String getServiceName() {
      return serviceName;
    }

    public String getAddress() {
      return address;
    }

    public String getTimeStamp() {
      return timestamp;
    }
  }
}
