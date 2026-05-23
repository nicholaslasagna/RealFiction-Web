package com.realfiction.realcore.stats.producer;

import com.realfiction.realcore.stats.NetworkStatWriter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Minimal recording {@link NetworkStatWriter} for producer tests. */
final class StatProducerTestSupport {
  private StatProducerTestSupport() {}

  static final class Recording implements NetworkStatWriter {
    final List<Increment> increments = new ArrayList<>();
    final List<Set> sets = new ArrayList<>();

    @Override
    public void increment(String statKey, UUID subject, String displayName, long delta) {
      increments.add(new Increment(statKey, subject, displayName, delta));
    }

    @Override
    public void set(String statKey, UUID subject, String displayName, double value) {
      sets.add(new Set(statKey, subject, displayName, value));
    }

    @Override
    public void requestFlush() {
    }

    int incrementCountFor(String statKey) {
      int count = 0;
      for (Increment increment : increments) {
        if (statKey.equals(increment.statKey)) {
          count++;
        }
      }
      return count;
    }

    long incrementValueFor(String statKey, UUID subject) {
      long total = 0;
      for (Increment increment : increments) {
        if (statKey.equals(increment.statKey) && subject.equals(increment.subject)) {
          total += increment.delta;
        }
      }
      return total;
    }
  }

  record Increment(String statKey, UUID subject, String displayName, long delta) {}
  record Set(String statKey, UUID subject, String displayName, double value) {}
}
