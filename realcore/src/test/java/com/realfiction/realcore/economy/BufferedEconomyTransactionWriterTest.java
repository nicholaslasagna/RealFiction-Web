package com.realfiction.realcore.economy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.realfiction.realcore.api.PlatformApiException;
import com.realfiction.realcore.api.dto.EconomyTransactionsRequest;
import com.realfiction.realcore.api.dto.EconomyTransactionsResponse;
import com.realfiction.realcore.config.EconomyConfig;
import com.realfiction.realcore.config.RealCoreConfig;
import com.realfiction.realcore.scheduler.RealCoreScheduler;
import com.realfiction.realcore.scheduler.ScheduledTaskHandle;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Logger;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

final class BufferedEconomyTransactionWriterTest {
  private RealCoreConfig config;
  private EconomyConfig economyConfig;
  private RecordingTransport transport;
  private BufferedEconomyTransactionWriter writer;

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
        economy:
          enabled: true
          currencyKey: "realfiction_main"
          flushSeconds: 30
          bufferSize: 10
          maxBatchSize: 2
        """);
    config = RealCoreConfig.from(yaml);
    economyConfig = config.economy();
    transport = new RecordingTransport();
    writer = new BufferedEconomyTransactionWriter(
        config, economyConfig, new NoopScheduler(), transport, Logger.getLogger("test"), true);
    writer.start();
  }

  @Test
  void flushesTransactionsWithMinorUnitsAndCurrency() {
    writer.enqueue(earn("idem-1", 25000));
    transport.completeWithSuccess(1, 0, false);

    writer.flushOnce();

    EconomyTransactionsRequest request = transport.lastRequest();
    assertNotNull(request);
    assertEquals("smp-1", request.serverId);
    assertEquals("smp", request.serverGroup);
    assertEquals("realfiction_main", request.currencyKey);
    assertEquals(1, request.transactions.size());
    assertEquals(25000, request.transactions.get(0).amountMinor);
    assertEquals("gameplay_earn", request.transactions.get(0).category);
    assertEquals(1, writer.appliedTransactionCount());
    assertEquals(0, writer.queuedTransactionCount());
  }

  @Test
  void transientFailureRetriesSameBatchId() {
    writer.enqueue(earn("idem-1", 100));
    transport.completeWithTransientError();

    writer.flushOnce();

    assertEquals(1, writer.pendingBatchCount());
    EconomyTransactionsRequest first = transport.lastRequest();

    transport.completeWithSuccess(1, 0, false);
    writer.flushOnce();

    EconomyTransactionsRequest retry = transport.lastRequest();
    assertEquals(first.batchId, retry.batchId);
    assertEquals(0, writer.pendingBatchCount());
  }

  @Test
  void duplicateResponseIsObserved() {
    writer.enqueue(earn("idem-1", 100));
    transport.completeWithSuccess(0, 1, true);

    writer.flushOnce();

    assertEquals(1, writer.duplicateBatchCount());
    assertEquals(1, writer.duplicateTransactionCount());
  }

  @Test
  void clientErrorDropsBatch() {
    writer.enqueue(earn("idem-1", 100));
    transport.completeWithClientError(400);

    writer.flushOnce();

    assertEquals(1, writer.droppedBatchCount());
    assertEquals(1, writer.failedBatchCount());
    assertEquals(0, writer.pendingBatchCount());
  }

  @Test
  void disabledMutationWriterDoesNotStartOrAcceptTransactions() {
    BufferedEconomyTransactionWriter disabled = new BufferedEconomyTransactionWriter(
        config, economyConfig, new NoopScheduler(), transport, Logger.getLogger("test"), false);

    disabled.start();

    assertFalse(disabled.running());
    assertFalse(disabled.enqueue(earn("idem-disabled", 100)));
  }

  @Test
  void maxBatchSizeSplitsFreshBatches() {
    writer.enqueue(earn("idem-1", 100));
    writer.enqueue(earn("idem-2", 200));
    writer.enqueue(earn("idem-3", 300));
    transport.completeWithSuccess(2, 0, false);

    writer.flushOnce();
    EconomyTransactionsRequest first = transport.lastRequest();
    assertEquals(2, first.transactions.size());

    transport.completeWithSuccess(1, 0, false);
    writer.flushOnce();
    EconomyTransactionsRequest second = transport.lastRequest();
    assertNotEquals(first.batchId, second.batchId);
    assertEquals(1, second.transactions.size());
  }

  private static EconomyTransaction earn(String idempotencyKey, long amountMinor) {
    return EconomyTransaction.credit(
        UUID.randomUUID(),
        "Alex",
        amountMinor,
        EconomyCategory.GAMEPLAY_EARN,
        "Test earn",
        idempotencyKey,
        "test",
        idempotencyKey,
        Map.of("test", true)
    );
  }

  private static final class RecordingTransport implements EconomyTransactionsTransport {
    private final List<EconomyTransactionsRequest> requests = new ArrayList<>();
    private final AtomicReference<CompletableFuture<EconomyTransactionsResponse>> nextResponse =
        new AtomicReference<>(CompletableFuture.completedFuture(makeResponse(1, 0, false)));

    void completeWithSuccess(int applied, int duplicates, boolean duplicateBatch) {
      nextResponse.set(CompletableFuture.completedFuture(makeResponse(applied, duplicates, duplicateBatch)));
    }

    void completeWithTransientError() {
      CompletableFuture<EconomyTransactionsResponse> future = new CompletableFuture<>();
      future.completeExceptionally(new PlatformApiException("HTTP 503", 503));
      nextResponse.set(future);
    }

    void completeWithClientError(int statusCode) {
      CompletableFuture<EconomyTransactionsResponse> future = new CompletableFuture<>();
      future.completeExceptionally(new PlatformApiException("HTTP " + statusCode, statusCode));
      nextResponse.set(future);
    }

    EconomyTransactionsRequest lastRequest() {
      return requests.isEmpty() ? null : requests.get(requests.size() - 1);
    }

    @Override
    public CompletableFuture<EconomyTransactionsResponse> send(EconomyTransactionsRequest request) {
      requests.add(request);
      return nextResponse.get();
    }

    private static EconomyTransactionsResponse makeResponse(int applied, int duplicates, boolean duplicateBatch) {
      EconomyTransactionsResponse response = new EconomyTransactionsResponse();
      response.ok = true;
      response.applied = applied;
      response.duplicates = duplicates;
      response.duplicateBatch = duplicateBatch;
      response.scale = 100;
      return response;
    }
  }

  private static final class NoopScheduler implements RealCoreScheduler {
    @Override public String name() { return "noop"; }
    @Override public boolean folia() { return false; }
    @Override public void runAsync(Runnable task) { task.run(); }
    @Override public ScheduledTaskHandle runAsyncRepeating(Runnable task, long initialDelaySeconds, long periodSeconds) {
      return () -> {};
    }
    @Override public ScheduledTaskHandle runGlobalRepeating(Runnable task, long initialDelayTicks, long periodTicks) {
      return () -> {};
    }
    @Override public void runGlobal(Runnable task) { task.run(); }
    @Override public void runForPlayer(org.bukkit.entity.Player player, Runnable task) { task.run(); }
    @Override public void runForPlayerLater(org.bukkit.entity.Player player, Runnable task, long delayTicks) {
      task.run();
    }
    @Override public CompletableFuture<Void> dispatchConsoleCommand(String command) {
      return CompletableFuture.completedFuture(null);
    }
    @Override public void close() {}
  }
}
