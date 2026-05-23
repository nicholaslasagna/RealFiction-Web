package com.realfiction.realcore.stats;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.api.PlatformApiException;
import com.realfiction.realcore.api.dto.StatEventsRequest;
import com.realfiction.realcore.api.dto.StatEventsResponse;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.config.StatsConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Logger;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

final class BufferedNetworkStatWriterTest {
  private RealCoreConfig config;
  private StatsConfig.WriterConfig writerConfig;
  private RecordingTransport transport;
  private NoopScheduler scheduler;
  private BufferedNetworkStatWriter writer;

  @BeforeEach
  void setUp() throws InvalidConfigurationException {
    YamlConfiguration yaml = new YamlConfiguration();
    yaml.loadFromString("""
        baseUrl: "https://realfiction.test"
        server:
          id: "smp-1"
          group: "smp"
          displayName: "SMP 1"
        hmacSecret: "test-secret"
        debug: true
        modules:
          stats: true
        """);
    config = RealCoreConfig.from(yaml);
    writerConfig = new StatsConfig.WriterConfig(Duration.ofSeconds(30), 100);
    transport = new RecordingTransport();
    scheduler = new NoopScheduler();
    writer = new BufferedNetworkStatWriter(config, writerConfig, scheduler, transport, Logger.getLogger("test"));
    writer.start();
  }

  @Test
  void incrementsAggregateUnderSameKey() {
    UUID alex = UUID.randomUUID();
    writer.increment("kills.total", alex, "Alex", 1);
    writer.increment("kills.total", alex, "Alex", 4);
    writer.increment("kills.total", alex, "Alex", 5);

    transport.completeWithSuccess();
    writer.flushOnce();

    StatEventsRequest sent = transport.lastRequest();
    assertNotNull(sent);
    assertEquals(1, sent.events.size());
    StatEventsRequest.Event event = sent.events.get(0);
    assertEquals("kills.total", event.statKey);
    assertEquals(alex.toString(), event.subjectId);
    assertEquals("increment", event.mode);
    assertEquals(10.0, event.value, 0.0001);
    assertEquals(1, writer.flushSuccessCount());
    assertEquals(0, writer.flushFailureCount());
    assertEquals(0, writer.workingEventCountSnapshot());
  }

  @Test
  void setKeepsLatestValueOnly() {
    UUID alex = UUID.randomUUID();
    writer.set("money.total", alex, "Alex", 100);
    writer.set("money.total", alex, "Alex", 250);
    writer.set("money.total", alex, "Alex", 175);

    transport.completeWithSuccess();
    writer.flushOnce();

    StatEventsRequest sent = transport.lastRequest();
    assertEquals(1, sent.events.size());
    StatEventsRequest.Event event = sent.events.get(0);
    assertEquals("money.total", event.statKey);
    assertEquals("set", event.mode);
    assertEquals(175.0, event.value, 0.0001);
  }

  @Test
  void negativeIncrementIsDropped() {
    UUID alex = UUID.randomUUID();
    writer.increment("kills.total", alex, "Alex", -3);
    writer.increment("kills.total", alex, "Alex", 0);

    transport.completeWithSuccess();
    writer.flushOnce();

    assertEquals(0, transport.requestCount());
    assertEquals(0, writer.workingEventCountSnapshot());
  }

  @Test
  void nullArgumentsAreNoOp() {
    UUID alex = UUID.randomUUID();
    writer.increment(null, alex, "Alex", 1);
    writer.increment("kills.total", null, "Alex", 1);
    writer.set("money.total", null, "Alex", 5);
    writer.set("money.total", alex, "Alex", Double.NaN);
    writer.set("money.total", alex, "Alex", Double.POSITIVE_INFINITY);

    assertEquals(0, writer.workingEventCountSnapshot());
  }

  @Test
  void transientFailureRequeuesBatchWithSameBatchId() {
    UUID alex = UUID.randomUUID();
    writer.increment("kills.total", alex, "Alex", 7);

    transport.completeWithTransientError();
    writer.flushOnce();

    assertEquals(1, transport.requestCount());
    StatEventsRequest first = transport.lastRequest();
    assertEquals(1, writer.pendingBatchCount());
    assertEquals(1, writer.flushFailureCount());

    transport.completeWithSuccess();
    writer.flushOnce();

    assertEquals(2, transport.requestCount());
    StatEventsRequest retry = transport.lastRequest();
    assertEquals(first.batchId, retry.batchId,
        "transient retry must reuse the original batchId so the dedup ledger no-ops a true duplicate");
    assertEquals(0, writer.pendingBatchCount());
    assertEquals(1, writer.flushSuccessCount());
  }

  @Test
  void clientErrorDropsBatchAndDoesNotRetry() {
    UUID alex = UUID.randomUUID();
    writer.increment("kills.total", alex, "Alex", 1);

    transport.completeWithClientError(400);
    writer.flushOnce();

    assertEquals(1, transport.requestCount());
    assertEquals(0, writer.pendingBatchCount(), "4xx must not requeue");
    assertEquals(1, writer.droppedBatchCount());
    assertEquals(1, writer.flushFailureCount());
  }

  @Test
  void newEventsKeepGrowingWhilePendingBatchAwaitsRetry() {
    UUID alex = UUID.randomUUID();
    UUID jordan = UUID.randomUUID();

    writer.increment("kills.total", alex, "Alex", 1);
    transport.completeWithTransientError();
    writer.flushOnce();
    StatEventsRequest stuck = transport.lastRequest();
    assertEquals(1, writer.pendingBatchCount());

    writer.increment("kills.total", jordan, "Jordan", 5);

    transport.completeWithSuccess();
    writer.flushOnce();
    StatEventsRequest secondCall = transport.lastRequest();
    assertEquals(stuck.batchId, secondCall.batchId, "retry first");
    assertEquals(0, writer.pendingBatchCount());

    transport.completeWithSuccess();
    writer.flushOnce();
    StatEventsRequest thirdCall = transport.lastRequest();
    assertNotEquals(stuck.batchId, thirdCall.batchId, "fresh batch needs a new batchId");
    assertEquals(1, thirdCall.events.size());
    assertEquals(jordan.toString(), thirdCall.events.get(0).subjectId);
  }

  @Test
  void duplicateResponseCountsTowardDuplicates() {
    UUID alex = UUID.randomUUID();
    writer.increment("votes.total", alex, "Alex", 1);

    transport.completeWithDuplicate();
    writer.flushOnce();

    assertEquals(1, writer.duplicateBatchCount());
    assertEquals(0, writer.flushSuccessCount());
    assertEquals(0, writer.flushFailureCount());
  }

  @Test
  void bufferOverflowDropsExcessEventsAndCounts() {
    int distinctSlots = writerConfig.bufferSize();
    int dropTarget = 250;
    for (int i = 0; i < distinctSlots + dropTarget; i++) {
      writer.increment("kills.total", UUID.randomUUID(), "P" + i, 1);
    }
    assertEquals(distinctSlots, writer.workingEventCountSnapshot());
    assertTrue(writer.droppedEventCount() >= dropTarget,
        "expected at least " + dropTarget + " dropped events, got " + writer.droppedEventCount());
  }

  @Test
  void stopClearsBuffersAndPending() {
    UUID alex = UUID.randomUUID();
    writer.increment("kills.total", alex, "Alex", 1);
    transport.completeWithTransientError();
    writer.flushOnce();
    assertEquals(1, writer.pendingBatchCount());

    writer.increment("kills.total", alex, "Alex", 2);
    assertTrue(writer.queuedEventCount() > 0);

    writer.stop();
    assertEquals(0, writer.queuedEventCount());
    assertEquals(0, writer.pendingBatchCount());
    assertFalse(writer.running());
  }

  // ---- Test doubles -------------------------------------------------------

  private static final class RecordingTransport implements StatEventsTransport {
    private final List<StatEventsRequest> requests = new ArrayList<>();
    private final AtomicReference<CompletableFuture<StatEventsResponse>> nextResponse =
        new AtomicReference<>(CompletableFuture.completedFuture(makeResponse(true, false, 0)));

    void completeWithSuccess() {
      nextResponse.set(CompletableFuture.completedFuture(makeResponse(true, false, 1)));
    }

    void completeWithDuplicate() {
      nextResponse.set(CompletableFuture.completedFuture(makeResponse(true, true, 0)));
    }

    void completeWithTransientError() {
      CompletableFuture<StatEventsResponse> future = new CompletableFuture<>();
      future.completeExceptionally(new PlatformApiException("HTTP 503", 503));
      nextResponse.set(future);
    }

    void completeWithClientError(int statusCode) {
      CompletableFuture<StatEventsResponse> future = new CompletableFuture<>();
      future.completeExceptionally(new PlatformApiException("HTTP " + statusCode, statusCode));
      nextResponse.set(future);
    }

    StatEventsRequest lastRequest() {
      return requests.isEmpty() ? null : requests.get(requests.size() - 1);
    }

    int requestCount() {
      return requests.size();
    }

    @Override
    public CompletableFuture<StatEventsResponse> send(StatEventsRequest request) {
      requests.add(request);
      return nextResponse.get();
    }

    private static StatEventsResponse makeResponse(boolean ok, boolean duplicate, int applied) {
      StatEventsResponse response = new StatEventsResponse();
      response.ok = ok;
      response.duplicate = duplicate;
      response.applied = applied;
      return response;
    }
  }

  private static final class NoopScheduler implements RealCoreScheduler {
    @Override
    public String name() {
      return "noop";
    }

    @Override
    public boolean folia() {
      return false;
    }

    @Override
    public ScheduledTaskHandle runAsyncRepeating(Runnable task, long initialDelaySeconds, long periodSeconds) {
      return () -> {};
    }

    @Override
    public ScheduledTaskHandle runGlobalRepeating(Runnable task, long initialDelayTicks, long periodTicks) {
      return () -> {};
    }

    @Override
    public void runGlobal(Runnable task) {
      task.run();
    }

    @Override
    public void runForPlayer(org.bukkit.entity.Player player, Runnable task) {
      task.run();
    }

    @Override
    public void runForPlayerLater(org.bukkit.entity.Player player, Runnable task, long delayTicks) {
      task.run();
    }

    @Override
    public CompletableFuture<Void> dispatchConsoleCommand(String command) {
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public void close() {
    }
  }
}
