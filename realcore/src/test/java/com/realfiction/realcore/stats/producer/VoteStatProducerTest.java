package com.realfiction.realcore.stats.producer;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.realfiction.realcore.api.dto.RewardPayload;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class VoteStatProducerTest {
  @Test
  void countsExactlyOneVoteOnVoteStandard() {
    StatProducerTestSupport.Recording writer = new StatProducerTestSupport.Recording();
    VoteStatProducer producer = new VoteStatProducer(writer, "smp");
    UUID alex = UUID.randomUUID();

    producer.onRewardDelivered(rewardOf("vote.standard", alex.toString(), "Alex"));

    assertEquals(1, writer.incrementValueFor("votes.total", alex));
    assertEquals(1, writer.incrementValueFor("votes.smp", alex));
    assertEquals(2, writer.increments.size());
  }

  @Test
  void ignoresMilestoneRewardsToAvoidDoubleCount() {
    StatProducerTestSupport.Recording writer = new StatProducerTestSupport.Recording();
    VoteStatProducer producer = new VoteStatProducer(writer, "smp");
    UUID alex = UUID.randomUUID();

    producer.onRewardDelivered(rewardOf("vote.milestone.5", alex.toString(), "Alex"));
    producer.onRewardDelivered(rewardOf("vote.milestone.30", alex.toString(), "Alex"));

    assertEquals(0, writer.increments.size());
  }

  @Test
  void ignoresStoreRewards() {
    StatProducerTestSupport.Recording writer = new StatProducerTestSupport.Recording();
    VoteStatProducer producer = new VoteStatProducer(writer, "smp");
    UUID alex = UUID.randomUUID();

    producer.onRewardDelivered(rewardOf("store.donor.tier1", alex.toString(), "Alex"));

    assertEquals(0, writer.increments.size());
  }

  @Test
  void ignoresMissingUuid() {
    StatProducerTestSupport.Recording writer = new StatProducerTestSupport.Recording();
    VoteStatProducer producer = new VoteStatProducer(writer, "smp");

    producer.onRewardDelivered(rewardOf("vote.standard", null, "Alex"));
    producer.onRewardDelivered(rewardOf("vote.standard", "not-a-uuid", "Alex"));

    assertEquals(0, writer.increments.size());
  }

  @Test
  void parsesUnhyphenatedUuid() {
    StatProducerTestSupport.Recording writer = new StatProducerTestSupport.Recording();
    VoteStatProducer producer = new VoteStatProducer(writer, "smp");
    UUID alex = UUID.randomUUID();
    String unhyphenated = alex.toString().replace("-", "");

    producer.onRewardDelivered(rewardOf("vote.standard", unhyphenated, "Alex"));

    assertEquals(1, writer.incrementValueFor("votes.total", alex));
    assertEquals(1, writer.incrementValueFor("votes.smp", alex));
  }

  @Test
  void allGroupSkipsScopedKey() {
    StatProducerTestSupport.Recording writer = new StatProducerTestSupport.Recording();
    VoteStatProducer producer = new VoteStatProducer(writer, "all");
    UUID alex = UUID.randomUUID();

    producer.onRewardDelivered(rewardOf("vote.standard", alex.toString(), "Alex"));

    assertEquals(1, writer.incrementValueFor("votes.total", alex));
    assertEquals(1, writer.increments.size());
  }

  private static RewardPayload rewardOf(String rewardKey, String uuid, String username) {
    RewardPayload reward = new RewardPayload();
    reward.id = UUID.randomUUID().toString();
    reward.rewardKey = rewardKey;
    RewardPayload.Target target = new RewardPayload.Target();
    target.minecraftUuid = uuid;
    target.minecraftUsername = username;
    reward.target = target;
    return reward;
  }
}
