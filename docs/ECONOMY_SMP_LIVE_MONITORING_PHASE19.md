# SMP live monitoring and stability validation (Phase 19)

Operational monitoring after the **first successful** live SMP `shop_sell` ledger write
(Phase 18). This phase validates stability under real traffic — it is **not** full
production rollout and does **not** expand scope to other backends or categories.

**Prerequisite:** [ECONOMY_SMP_SHOP_SELL_LIVE_EXECUTION.md](./ECONOMY_SMP_SHOP_SELL_LIVE_EXECUTION.md) completed with one verified live sell.

**Related:** [ECONOMY_GAMEPLAY_OBSERVABILITY.md](./ECONOMY_GAMEPLAY_OBSERVABILITY.md) — metric names and `/rf economy gameplay` fields.

---

## 1. Purpose

Phase 19 validates that live `shop_sell` capture and ledger writes remain safe over time:

| Area | What we validate |
|------|------------------|
| **Stability** | SMP TPS/MSPT, RealCore no error storms |
| **Throughput** | Batch rate matches sell volume; no runaway API calls |
| **Idempotency** | One ledger row per sell event; duplicates suppressed |
| **Queue safety** | Gameplay queue drains; no overflow/expiry drops |
| **DB / Vault consistency** | Sampled drift understood; no unexplained double-credit |
| **Cloudflare / API** | HMAC balance + transaction paths healthy; no 429/5xx storms |
| **No duplicate credits** | Balance increases match sells; no duplicate idempotency keys applied twice |
| **No drift explosion** | Shadow/delta samples do not grow without explanation |

This is still **NOT** full production rollout. Vote rewards on Lobby1 stay production-critical and **untouched**.

---

## 2. Allowed live scope

**ONLY** the following may remain live during Phase 19:

| Setting | Value |
|---------|--------|
| Backend | `smp-1` |
| Category | `shop_sell` only |
| Supabase `smp-1` | `can_earn=true`, **`can_spend=false`**, `can_reward=false` |
| Plugin `gameplaySync.dryRun` | `false` (for gameplay path) |
| Producer `economyShopGuiSell` | `enabled=true`, `dryRun=false` |

**Everything else remains disabled:**

| Disabled | Notes |
|----------|--------|
| `gameplay_spend`, `shop_buy`, `gameplay_earn` (generic) | Categories off in config |
| Factions, Arcade, Anarchy | No jar/config/policy changes |
| Automatic Vault ↔ DB reconciliation | No `syncVaultFromDb` apply on SMP |
| Vote reward path changes | Lobby1 only for `vote_reward` |
| `dryRun=false` on other producers | None wired |

If scope creeps beyond this table, **stop** and roll back to Phase 18 §9.

---

## 3. Monitoring window

### Recommended duration

| Minimum | Ideal |
|---------|--------|
| **24 hours** after first live sell | **Several days** of representative SMP activity before any scope expansion |

Include at least one peak-hours block (evening/weekend) if possible.

### Track (daily log)

| Metric | Source |
|--------|--------|
| Total EconomyShopGUI sells observed (estimate) | Staff notes / producer `captured` |
| Total `shop_sell` ledger rows (`smp-1`) | SQL §5A–B |
| Duplicate count (API + plugin) | `/rf economy gameplay` + SQL §5C |
| Failed batches | Writer `batchesFailed`, logs `[GameplaySync:ERROR]` |
| Queue overflow | `overflow` / `gameplayDropped` |
| Expired queue entries | `gameplayDropped`, log `gameplay-queue-expire` |
| API errors | Last failure, HTTP status, Cloudflare analytics |
| Cloudflare usage | Workers/dashboard request rate to economy routes |
| TPS / MSPT | SMP `/tps` or spark |
| DB vs Vault drift (sample) | §6 manual checks |

Use a simple spreadsheet or ticket checklist with date, operator, and pass/fail.

---

## 4. Required commands

Run on **SMP** at least **every 4–6 hours** during the monitoring window (more often during peak).

```text
/rf economy
/rf economy gameplay
/rf economy gameplay producers
/rf economy gameplay preflight live
```

### Expected (healthy)

| Check | Expected |
|-------|----------|
| Preflight summary | **READY** |
| `WARN dbPolicyWritePermissionNotProven` | Allowed if still present |
| Any **FAIL** | **Stop** — rollback |
| Gameplay queue depth | Near **zero** between flush intervals |
| Retry queue / batches | Near **zero** |
| Overflow / permanent rejects | **0** or stable zero |
| Duplicate storm | No sustained spike |
| Categories | Only `shop_sell` activity; no unexpected toggles |
| Producer hook | `listening for PostTransactionEvent (SELL)` |
| Writer last HTTP | **200** or idle; no recent 4xx/5xx |

Record counter snapshots in your monitoring log (copy/paste from console).

### Counter fields (reference)

From [ECONOMY_GAMEPLAY_OBSERVABILITY.md](./ECONOMY_GAMEPLAY_OBSERVABILITY.md):

- Producer: `captured`, `queued`, `duplicateRejected`, `dryRunCaptured` (should stay 0 in live)
- Gameplay writer (isolated): `gameplayQueued`, ok, dup, fail, dropped
- Writer global: `batchesSent`, `batchesFailed`, `transactionsSucceeded`, `duplicateTransactions`, `queueOverflowDrops`

---

## 5. Verification SQL

Run in Supabase SQL Editor (read-only). Scope queries to the monitoring window where noted.

### A. Recent shop_sell rows

```sql
select
  id,
  minecraft_username,
  amount_minor,
  balance_after_minor,
  idempotency_key,
  source_server_id,
  created_at
from public.economy_ledger
where category = 'shop_sell'
  and source_server_id = 'smp-1'
  and created_at > now() - interval '7 days'
order by created_at desc
limit 50;
```

### B. Count by category (network-wide sanity)

```sql
select category, count(*) as row_count
from public.economy_ledger
where created_at > now() - interval '7 days'
group by category
order by row_count desc;
```

**Expected:** `shop_sell` only from `smp-1` for gameplay categories; `vote_reward` from `lobby-1`.

### C. Duplicate idempotency detection

```sql
select idempotency_key, count(*) as row_count, sum(amount_minor) as total_minor
from public.economy_ledger
where category = 'shop_sell'
  and source_server_id = 'smp-1'
  and created_at > now() - interval '7 days'
group by idempotency_key
having count(*) > 1;
```

**Expected:** **zero rows.**

### D. Batch statistics

```sql
select
  server_id,
  count(*) as batch_count,
  sum(submitted_count) as txs_submitted,
  sum(applied_count) as txs_applied,
  sum(duplicate_count) as txs_duplicate,
  max(created_at) as last_batch_at
from public.economy_transaction_batches
where server_id = 'smp-1'
  and created_at > now() - interval '7 days'
group by server_id;
```

```sql
select batch_id, submitted_count, applied_count, duplicate_count, status, created_at
from public.economy_transaction_batches
where server_id = 'smp-1'
  and created_at > now() - interval '24 hours'
order by created_at desc
limit 30;
```

### E. Largest transactions (cap sanity)

```sql
select id, minecraft_username, amount_minor, idempotency_key, created_at
from public.economy_ledger
where category = 'shop_sell'
  and source_server_id = 'smp-1'
  and created_at > now() - interval '7 days'
order by amount_minor desc
limit 20;
```

**Expected:** all `amount_minor <= 50000` (policy cap) unless staff approved exceptions.

### F. SMP-only gameplay rows

```sql
select source_server_id, category, count(*) as n
from public.economy_ledger
where category in ('shop_sell', 'shop_buy', 'gameplay_earn', 'gameplay_spend', 'spend')
  and created_at > now() - interval '7 days'
group by source_server_id, category
order by source_server_id, category;
```

**Expected:** `shop_sell` only under `smp-1`; no other server IDs.

### G. No Factions / Arcade / Anarchy gameplay rows

```sql
select source_server_id, category, count(*) as n
from public.economy_ledger
where source_server_id in ('factions-1', 'arcade-1', 'anarchy-1')
  and category in ('shop_sell', 'shop_buy', 'gameplay_earn', 'gameplay_spend', 'spend')
  and created_at > now() - interval '7 days'
group by source_server_id, category;
```

**Expected:** **zero rows.**

### H. No gameplay_spend / shop_buy rows (any server)

```sql
select source_server_id, category, count(*) as n
from public.economy_ledger
where category in ('shop_buy', 'gameplay_spend', 'spend')
  and created_at > now() - interval '7 days'
group by source_server_id, category;
```

**Expected:** **zero rows** (or historical only before live trial).

### I. vote_reward still Lobby1 only

```sql
select source_server_id, count(*) as n, max(created_at) as latest
from public.economy_ledger
where category = 'vote_reward'
  and created_at > now() - interval '7 days'
group by source_server_id
order by n desc;
```

**Expected:** `lobby-1` dominates; **`smp-1` must not appear.**

---

## 6. Drift validation (manual DB vs Vault)

This phase validates **capture + ledger integrity**, not final authoritative balance sync.

### Procedure (sample 3–5 SMP players per day)

1. Pick online or recently active players (not staff alts only).
2. On SMP console:

```text
/rf economy balance <player>
```

3. Record **DB balance** (canonical ledger) and **Vault balance** + `deltaMinor` from command output.
4. Note recent sells since last check.

### Expected interpretation

| Observation | Expected in Phase 19 |
|-------------|----------------------|
| Vault pays sells immediately | Yes — EconomyShopGUI unchanged |
| DB balance lags or differs from Vault | **Acceptable** — Vault remains authoritative **in-game** |
| DB increases after sells by ~sell amount | Yes, when ledger applied |
| Large unexplained DB jump without sell | **Investigate** — possible duplicate or wrong category |
| Drift grows without sells | **Stop** — rollback and review |

Do **not** run mass `syncfromdb --apply` during Phase 19 unless a separate approved incident procedure exists.

---

## 7. Performance expectations

### Normal behavior

| Signal | Healthy pattern |
|--------|-----------------|
| Writer batching | Batches every `flushSeconds` (~30s); batch sizes small vs `maxBatchSize` |
| Request volume | ~1 API batch per flush window per backlog, not continuous spam |
| Queue growth | Spikes during sell bursts, returns to ~0 within 1–2 flush cycles |
| MSPT / TPS | No sustained degradation vs pre-trial baseline |
| Cloudflare | Economy routes low QPS; no error rate spike |

### Warning thresholds (investigate; escalate if sustained)

| Threshold | Action |
|-----------|--------|
| Retry depth **> 5** batches | Check API errors; consider rollback |
| Gameplay queue depth **> 1000** | Stop sells; rollback if not draining |
| Repeated **429** on economy API | Rate limit / backoff; rollback if continuing |
| Duplicate counter spike (plugin or API) | Check EconomyShopGUI double events |
| **Permanent rejects** > 0 | Policy/cap mismatch — rollback |
| `gameplayDropped` increasing | Overflow or expiry — rollback |
| Oldest queue age **growing continuously** | Writer stuck — rollback |
| `shop_sell` rows with `amount_minor > 50000` | Cap breach — stop |

---

## 8. Stop conditions

**Immediately disable** live `shop_sell` (§9 rollback) if any occur:

| Condition |
|-----------|
| Duplicate credits (same sell, two applied ledger rows or double balance jump) |
| Wrong `amount_minor` vs EconomyShopGUI price |
| Repeated **4xx / 5xx** on economy batch path |
| Queue overflow or sustained non-draining queue |
| Batch **retry storm** (`batchesRetried` climbing without recovery) |
| Idempotency failure (§5C returns rows) |
| Cloudflare **runaway** requests to plugin economy routes |
| Supabase **latency** or timeout errors correlated with sync |
| SMP **TPS / MSPT** sustained degradation |
| Unexpected categories in ledger or config |
| **Non-SMP** gameplay ledger rows (§5G) |
| **vote_reward** from SMP or Lobby regressions |
| Lobby1 vote delivery failures correlated with trial window |

---

## 9. Rollback

Same as Phase 18 — policy + plugin, preserve ledger.

### Plugin (SMP `config.yml`)

```yaml
economy:
  gameplaySync:
    dryRun: true
    enabled: false   # if needed
    producers:
      economyShopGuiSell:
        dryRun: true
        enabled: false   # if needed
```

Restart SMP (preferred).

### Policy SQL

```sql
update public.economy_server_policies
set
  can_earn = false,
  can_spend = false,
  can_reward = false,
  max_credit_minor = 0,
  max_debit_minor = 0,
  max_batch_count = 0,
  notes = 'SMP read-only DB economy access for shadow/alignment rollout.',
  updated_at = now()
where server_id = 'smp-1';
```

### Ledger

- **Preserve** all `economy_ledger` history.
- Erroneous credits: **compensating** `admin_adjustment` only after staff review — never delete rows.

### Do not touch

- Lobby1 jar/config
- Factions / Arcade / Anarchy

---

## 10. Success criteria (advance to next phase)

Phase 19 is **successful** only if the full monitoring window shows:

- [ ] **No** duplicate credits (SQL §5C clean; plugin dup counters stable)
- [ ] **Stable** queue behavior (depth ~0 between flushes; no overflow drops)
- [ ] **No** idempotency failures
- [ ] **Acceptable** Cloudflare / API usage (no 429/5xx storms)
- [ ] **Stable** SMP performance (TPS/MSPT vs baseline)
- [ ] **Stable** writer metrics (preflight live **READY** on spot checks)
- [ ] **No** unauthorized categories (§5H clean)
- [ ] **No** policy violations (amounts ≤ cap; `smp-1` only)
- [ ] **No** vote reward regressions (§5I; Lobby1 spot check)

Record: operator sign-off, window start/end UTC, total `shop_sell` rows, peak queue depth, any WARN notes.

**Approved for next phase (monitoring extension / broader earn):** yes / no / deferred — `________________`

---

## 11. Explicit note — not final architecture

At the end of Phase 19, the system is **still not** the final global economy architecture:

| Not done yet | Why |
|--------------|-----|
| Vault authoritative in-game | Players still spend/earn locally via EconomyShopGUI/Vault |
| `shop_buy` / `gameplay_spend` | Not implemented or enabled |
| DB-backed Vault provider | Not deployed |
| Automatic reconciliation | Shadow/observe only; no mass sync |
| Factions / Arcade / Anarchy rollout | Explicitly out of scope |

Phase 19 only proves that **live `shop_sell` ledger capture** is stable on SMP under controlled policy. Further phases decide scope expansion, spend categories, and long-term sync strategy ([GAMEPLAY_ECONOMY_SYNC_DESIGN.md](./GAMEPLAY_ECONOMY_SYNC_DESIGN.md) Phase 3+). Scope expansion and long-term Vault/DB authority: [ECONOMY_AUTHORITY_MODEL_PHASE20.md](./ECONOMY_AUTHORITY_MODEL_PHASE20.md).

---

## Monitoring log template

```markdown
### Phase 19 daily check — YYYY-MM-DD (operator: ___)

| Check | Pass | Notes |
|-------|------|-------|
| /rf economy gameplay preflight live | | |
| Queue / retry / overflow | | |
| SQL 5C duplicates | | |
| SQL 5G non-SMP | | |
| SQL 5I vote_reward | | |
| TPS/MSPT | | |
| Drift sample (n players) | | |

shop_sell rows (24h): ___  |  Failed batches: ___  |  Dup plugin: ___
```

---

## Related docs

| Doc | Role |
|-----|------|
| [ECONOMY_SMP_SHOP_SELL_LIVE_EXECUTION.md](./ECONOMY_SMP_SHOP_SELL_LIVE_EXECUTION.md) | First live sell (Phase 18) |
| [ECONOMY_SMP_SHOP_SELL_LIVE_TRIAL.md](./ECONOMY_SMP_SHOP_SELL_LIVE_TRIAL.md) | Trial overview |
| [ECONOMY_GAMEPLAY_OBSERVABILITY.md](./ECONOMY_GAMEPLAY_OBSERVABILITY.md) | Metrics reference |
| [ECONOMY_GAMEPLAY_PREFLIGHT.md](./ECONOMY_GAMEPLAY_PREFLIGHT.md) | Preflight live |
| [ECONOMY_AUTHORITY_MODEL_PHASE20.md](./ECONOMY_AUTHORITY_MODEL_PHASE20.md) | DB/Vault authority ADR (after monitoring) |
