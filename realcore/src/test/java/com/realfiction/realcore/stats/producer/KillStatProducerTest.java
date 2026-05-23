package com.realfiction.realcore.stats.producer;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.UUID;
import org.junit.jupiter.api.Test;

final class KillStatProducerTest {
  @Test
  void recordsKillAndDeathForPvpKill() {
    StatProducerTestSupport.Recording writer = new StatProducerTestSupport.Recording();
    KillStatProducer producer = new KillStatProducer(writer, "smp");
    UUID alex = UUID.randomUUID();
    UUID jordan = UUID.randomUUID();

    producer.recordDeath(alex, "Alex", jordan, "Jordan");

    assertEquals(1, writer.incrementValueFor("deaths.total", alex));
    assertEquals(1, writer.incrementValueFor("deaths.smp", alex));
    assertEquals(1, writer.incrementValueFor("kills.total", jordan));
    assertEquals(1, writer.incrementValueFor("kills.smp", jordan));
    assertEquals(4, writer.increments.size());
  }

  @Test
  void deathWithNoKillerCountsDeathOnly() {
    StatProducerTestSupport.Recording writer = new StatProducerTestSupport.Recording();
    KillStatProducer producer = new KillStatProducer(writer, "smp");
    UUID alex = UUID.randomUUID();

    producer.recordDeath(alex, "Alex", null, null);

    assertEquals(1, writer.incrementValueFor("deaths.total", alex));
    assertEquals(1, writer.incrementValueFor("deaths.smp", alex));
    assertEquals(0, writer.incrementCountFor("kills.total"));
    assertEquals(0, writer.incrementCountFor("kills.smp"));
  }

  @Test
  void selfKillDoesNotCreditKills() {
    StatProducerTestSupport.Recording writer = new StatProducerTestSupport.Recording();
    KillStatProducer producer = new KillStatProducer(writer, "smp");
    UUID alex = UUID.randomUUID();

    producer.recordDeath(alex, "Alex", alex, "Alex");

    assertEquals(1, writer.incrementValueFor("deaths.total", alex));
    assertEquals(1, writer.incrementValueFor("deaths.smp", alex));
    assertEquals(0, writer.incrementCountFor("kills.total"));
  }

  @Test
  void allGroupOnlyEmitsTotals() {
    StatProducerTestSupport.Recording writer = new StatProducerTestSupport.Recording();
    KillStatProducer producer = new KillStatProducer(writer, "all");
    UUID alex = UUID.randomUUID();
    UUID jordan = UUID.randomUUID();

    producer.recordDeath(alex, "Alex", jordan, "Jordan");

    assertEquals(1, writer.incrementValueFor("deaths.total", alex));
    assertEquals(1, writer.incrementValueFor("kills.total", jordan));
    assertEquals(0, writer.incrementCountFor("deaths.all"));
    assertEquals(0, writer.incrementCountFor("kills.all"));
    assertEquals(2, writer.increments.size());
  }

  @Test
  void blankGroupSkipsScopedKey() {
    StatProducerTestSupport.Recording writer = new StatProducerTestSupport.Recording();
    KillStatProducer producer = new KillStatProducer(writer, "");
    UUID alex = UUID.randomUUID();
    UUID jordan = UUID.randomUUID();

    producer.recordDeath(alex, "Alex", jordan, "Jordan");

    assertEquals(2, writer.increments.size());
  }

  @Test
  void nullVictimIsIgnored() {
    StatProducerTestSupport.Recording writer = new StatProducerTestSupport.Recording();
    KillStatProducer producer = new KillStatProducer(writer, "smp");

    producer.recordDeath(null, null, UUID.randomUUID(), "Jordan");

    assertEquals(0, writer.increments.size());
  }
}
