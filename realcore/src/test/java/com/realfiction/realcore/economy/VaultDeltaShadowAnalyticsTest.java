package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class VaultDeltaShadowAnalyticsTest {
  @Test
  void keepsOnlyBoundedRecentObservations() {
    VaultDeltaShadowAnalytics analytics = new VaultDeltaShadowAnalytics();

    analytics.record(observation(1, "First", 250, VaultDeltaShadowService.DeltaSeverity.SMALL, false), 2);
    analytics.record(observation(2, "Second", 500, VaultDeltaShadowService.DeltaSeverity.WARNING, false), 2);
    analytics.record(observation(3, "Third", 750, VaultDeltaShadowService.DeltaSeverity.SEVERE, false), 2);

    assertEquals(2, analytics.size());
    List<VaultDeltaShadowService.OffenderSummary> offenders = analytics.topOffenders(10, 1);
    assertEquals(2, offenders.size());
    assertTrue(offenders.stream().noneMatch(offender -> offender.username().equals("First")));
  }

  @Test
  void tracksRepeatedOffendersAndIgnoresMatchesOrIgnoredNoise() {
    VaultDeltaShadowAnalytics analytics = new VaultDeltaShadowAnalytics();
    UUID repeated = uuid(1);

    analytics.record(observation(repeated, "Repeat", 250, VaultDeltaShadowService.DeltaSeverity.SMALL, false), 10);
    analytics.record(observation(repeated, "Repeat", 500, VaultDeltaShadowService.DeltaSeverity.WARNING, false), 10);
    analytics.record(observation(2, "Match", 0, VaultDeltaShadowService.DeltaSeverity.MATCH, false), 10);
    analytics.record(observation(3, "Ignored", 10, VaultDeltaShadowService.DeltaSeverity.SMALL, true), 10);

    assertEquals(0, analytics.topOffenders(5, 3).size());

    List<VaultDeltaShadowService.OffenderSummary> offenders = analytics.topOffenders(5, 2);
    assertEquals(1, offenders.size());
    assertEquals(repeated, offenders.getFirst().uuid());
    assertEquals(2, offenders.getFirst().count());
    assertEquals("Repeat", offenders.getFirst().username());
  }

  private static VaultDeltaShadowService.Observation observation(
      int index,
      String username,
      long delta,
      VaultDeltaShadowService.DeltaSeverity severity,
      boolean ignored
  ) {
    return observation(uuid(index), username, delta, severity, ignored);
  }

  private static VaultDeltaShadowService.Observation observation(
      UUID uuid,
      String username,
      long delta,
      VaultDeltaShadowService.DeltaSeverity severity,
      boolean ignored
  ) {
    return new VaultDeltaShadowService.Observation(
        uuid,
        username,
        10_000,
        10_000 + delta,
        delta,
        Instant.parse("2026-05-25T00:00:00Z"),
        "smp-1",
        "smp",
        severity,
        ignored
    );
  }

  private static UUID uuid(int index) {
    return UUID.fromString("00000000-0000-0000-0000-%012d".formatted(index));
  }
}
