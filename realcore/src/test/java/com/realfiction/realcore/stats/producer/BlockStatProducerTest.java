package com.realfiction.realcore.stats.producer;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.UUID;
import org.junit.jupiter.api.Test;

final class BlockStatProducerTest {
  @Test
  void incrementsTotalAndScopedForBreak() {
    StatProducerTestSupport.Recording writer = new StatProducerTestSupport.Recording();
    BlockStatProducer producer = new BlockStatProducer(writer, "smp");
    UUID alex = UUID.randomUUID();

    producer.recordBreak(alex, "Alex");

    assertEquals(1, writer.incrementValueFor("blocks_broken.total", alex));
    assertEquals(1, writer.incrementValueFor("blocks_broken.smp", alex));
    assertEquals(2, writer.increments.size());
  }

  @Test
  void allGroupSkipsScoped() {
    StatProducerTestSupport.Recording writer = new StatProducerTestSupport.Recording();
    BlockStatProducer producer = new BlockStatProducer(writer, "all");
    UUID alex = UUID.randomUUID();

    producer.recordBreak(alex, "Alex");

    assertEquals(1, writer.incrementValueFor("blocks_broken.total", alex));
    assertEquals(1, writer.increments.size());
  }

  @Test
  void nullPlayerIsIgnored() {
    StatProducerTestSupport.Recording writer = new StatProducerTestSupport.Recording();
    BlockStatProducer producer = new BlockStatProducer(writer, "smp");

    producer.recordBreak(null, null);

    assertEquals(0, writer.increments.size());
  }
}
