# Gameplay Economy Observability (Phase 13)

Operator and engineering guide for **batch visibility**, **retry/duplicate/failure
telemetry**, and **queue safety** before enabling live SMP `shop_sell` ledger writes.

Defaults keep `economy.gameplaySync.enabled=false` and `dryRun=true`. This phase
does **not** enable gameplay writes.

## What was added

| Area | Capability |
|------|------------|
| `BufferedEconomyTransactionWriter` | Expanded batch/transaction counters, timing, HTTP status, structured logs |
| `GameplayEconomyWriterMetrics` | Gameplay-only counters (isolated from vote rewards) |
| `GameplayEconomyTransactionBuffer` | Gameplay queue limits, age expiry, overflow drops |
| `/rf economy gameplay` | Queue depth, writer telemetry, gameplay metrics, dry-run estimates |
| `/rf economy gameplay producers` | Capture rates, dedup stats, retry depth |
| Logs | `[GameplaySync:ERROR]`, `[GameplaySync:WARN]`, `[GameplaySync:BATCH]`, `[GameplaySync:QUEUE]` |

Vote rewards remain on `VoteRewardLedgerWriteService` (direct API, separate metrics).

## Commands

### `/rf economy gameplay`

Shows gameplay sync config, buffer counters, **gameplay-isolated writer metrics**,
queue depth, and (detailed) global writer batch telemetry + timing.

### `/rf economy gameplay producers`

Producer hook status, capture/dedup counters, capture rates, dedup cache fill,
gameplay queue vs limits, retry queue depth, and writer diagnostics.

## Metrics reference

### Global writer (`BufferedEconomyTransactionWriter`)

Includes staging test + gameplay transactions enqueued through the shared writer.

| Metric | Meaning |
|--------|---------|
| `batchesCreated` | Fresh batches drained from working queue |
| `batchesSent` | HTTP send attempts started |
| `batchesSucceeded` | Accepted HTTP responses |
| `batchesFailed` | Failed batches (transient or terminal) |
| `batchesRetried` | Sends from retry deque |
| `transactionsQueued` | Total enqueue count |
| `transactionsSucceeded` | Applied + duplicate txs from API |
| `transactionsFailed` | Failed/dropped txs |
| `duplicateTransactions` | API-reported duplicates |
| `permanentRejectTransactions` | 4xx batch drops |
| `transientFailureTransactions` | Transient errors (may retry) |
| `queueOverflowDrops` | Enqueue rejected (global buffer full) |
| `largestBatchSize` / `averageBatchSize` | Batch sizing |
| `lastSuccessfulFlushAt` | Last OK flush |
| `lastFailureAt` / `lastFailureReason` | Last error |
| `lastHttpStatus` | Last HTTP status (0 if non-HTTP error) |

### Gameplay-only (`GameplayEconomyWriterMetrics`)

Only transactions with idempotency keys `gameplay:...` (shop_sell producer path).

| Metric | Meaning |
|--------|---------|
| `gameplayQueued` | Gameplay txs accepted toward writer |
| `gameplaySucceeded` | Gameplay txs applied |
| `gameplayDuplicates` | Gameplay duplicate txs |
| `gameplayFailures` | Gameplay failed txs |
| `gameplayDropped` | Gameplay queue overflow / expiry drops |

### Dry-run simulation (no HTTP)

When `dryRun=true`:

| Metric | Meaning |
|--------|---------|
| `dryRunSimulatedTransactions` | Captures that would have queued |
| `dryRunSimulatedBatches` | Simulated flush windows |
| `dryRunEstimatedVolumeMinor` | Sum of simulated amounts |
| Est. tx/min & req/min | Shown on `/rf economy gameplay` |

## Config (`economy.gameplaySync.observability`)

```yaml
economy:
  gameplaySync:
    observability:
      enabled: true
      slowFlushMs: 2000
      slowHttpMs: 1000
      summaryIntervalSeconds: 300
      maxQueueEntries: 5000
      maxRetryEntries: 12
      maxTransactionAgeSeconds: 3600
```

| Key | Default | Purpose |
|-----|---------|---------|
| `enabled` | `true` | Structured logs + slow thresholds + periodic summaries |
| `slowFlushMs` | `2000` | WARN if flush duration exceeds |
| `slowHttpMs` | `1000` | WARN if HTTP leg exceeds |
| `summaryIntervalSeconds` | `300` | Periodic `[GameplaySync:BATCH] summary` log |
| `maxQueueEntries` | `5000` | Gameplay pre-writer queue cap |
| `maxRetryEntries` | `12` | Max pending retry batches (writer) |
| `maxTransactionAgeSeconds` | `3600` | Drop stale gameplay queue entries |

## Expected Cloudflare / API volume (dry-run)

Rough planning numbers for SMP shop sells (adjust with dry-run estimates):

| Assumption | Example |
|------------|---------|
| Active players selling | 10–30 in test window |
| Sells per minute (peak) | 5–20 |
| `flushSeconds` | 30 |
| `maxBatchSize` (global writer) | 100 |
| Batches per minute | ~2–4 at peak (batched) |

**Dry-run command check:** `/rf economy gameplay` → `Dry-run estimates: X tx/min, ~Y req/min`.

Monitor Cloudflare:

- Request rate to `/api/plugin/economy/transactions`
- 4xx/5xx ratio
- WAF/rate-limit events (403/429)

## Safe vs unsafe signals

| Safe (investigate, may continue dry-run) | Unsafe (stop; do not enable live writes) |
|------------------------------------------|------------------------------------------|
| `dryRunCaptured` rises, `queued=0` | `queued` rises while `dryRun=true` |
| Stable TPS/MSPT | Sustained TPS drop |
| Dedup rejects occasional | `duplicateRejected` storm |
| Dry-run estimates predictable | `permanentRejectTransactions` > 0 in dry-run |
| No `[GameplaySync:ERROR]` spam | HTTP 403/429 without explanation |
| Vote rewards unchanged on Lobby1 | `gameplayFailures` climbing in dry-run window |

## Plugin bug vs API policy reject

| Symptom | Likely cause |
|---------|----------------|
| `HTTP 403` / `HTTP 429` | Cloudflare WAF, rate limit, or auth edge |
| `HTTP 400` with policy message | Supabase `economy_server_policies` (`can_earn=false`, caps) |
| `HTTP 401` / HMAC errors | `hmacSecret` or clock/skew |
| `serialization failure` | Malformed payload/category in plugin |
| `category ... disabled` | RealCore config flags |
| `gameplay queue full` | Local backpressure (expected under load test) |
| `duplicate-storm` log | Duplicate events (check EconomyShopGUI double fire) |

**Fail closed:** no Vault reconciliation fallback. Fix config/policy or roll back.

## Retry / outage behavior

1. Transient errors keep batch in retry deque (same `batch_id`).
2. Retry deque capped by `maxRetryEntries`; oldest batches evicted → `droppedBatchCount`.
3. 4xx responses drop batch immediately (no retry).
4. During API outage, queue grows until `maxQueueEntries` / global `bufferSize` → drops with WARN.

## Rollback indicators

Roll back SMP config (not policy) if:

- `queueOverflowDrops` or `gameplayDropped` increase during dry-run load test
- `retry-queue-evict` warnings appear
- `lastFailureReason` shows repeated transient errors
- Cloudflare 403/429 correlates with economy plugin traffic

## Related docs

- [ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md](ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md)
- [ECONOMY_SMP_SHOP_SELL_LIVE_TRIAL.md](ECONOMY_SMP_SHOP_SELL_LIVE_TRIAL.md)
- [REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md](REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md)
