package com.realfiction.realcore.economy;

import java.util.ArrayDeque;
import java.util.Comparator;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

final class VaultDeltaShadowAnalytics {
  private final Object lock = new Object();
  private final Deque<VaultDeltaShadowService.Observation> observations = new ArrayDeque<>();
  private final Map<UUID, Integer> offenderCounts = new LinkedHashMap<>();

  void record(VaultDeltaShadowService.Observation observation, int maxSize) {
    int normalizedMax = Math.max(1, maxSize);
    synchronized (lock) {
      observations.addLast(observation);
      if (offenderObservation(observation)) {
        offenderCounts.merge(observation.uuid(), 1, Integer::sum);
      }
      while (observations.size() > normalizedMax) {
        VaultDeltaShadowService.Observation removed = observations.removeFirst();
        if (offenderObservation(removed)) {
          offenderCounts.computeIfPresent(removed.uuid(), (ignored, count) -> count <= 1 ? null : count - 1);
        }
      }
    }
  }

  int size() {
    synchronized (lock) {
      return observations.size();
    }
  }

  List<VaultDeltaShadowService.OffenderSummary> topOffenders(int limit, int minimumCount) {
    int threshold = Math.max(1, minimumCount);
    synchronized (lock) {
      return offenderCounts.entrySet().stream()
          .filter(entry -> entry.getValue() >= threshold)
          .sorted(Map.Entry.<UUID, Integer>comparingByValue(Comparator.reverseOrder()))
          .limit(Math.max(0, limit))
          .map(entry -> new VaultDeltaShadowService.OffenderSummary(entry.getKey(), entry.getValue(), latestUsername(entry.getKey())))
          .toList();
    }
  }

  private boolean offenderObservation(VaultDeltaShadowService.Observation observation) {
    return !observation.ignored() && observation.severity() != VaultDeltaShadowService.DeltaSeverity.MATCH;
  }

  private String latestUsername(UUID uuid) {
    VaultDeltaShadowService.Observation[] snapshot = observations.toArray(VaultDeltaShadowService.Observation[]::new);
    for (int i = snapshot.length - 1; i >= 0; i--) {
      if (snapshot[i].uuid().equals(uuid)) {
        return snapshot[i].username();
      }
    }
    return "unknown";
  }
}
