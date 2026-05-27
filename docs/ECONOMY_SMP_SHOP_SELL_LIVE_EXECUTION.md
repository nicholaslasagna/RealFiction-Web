# SMP live shop_sell trial — operator execution (Phase 18)

Final **manual** checklist for the first **live** SMP `shop_sell` ledger write: one
capped EconomyShopGUI sell → one `economy_ledger` row → balance update.

**This document does not execute anything.** No SQL runs automatically. No deploy.
No policy or plugin changes happen by merging this doc.

---

## Hard scope

| In scope | Out of scope |
|----------|----------------|
| **SMP** (`server.id: smp-1`) only | Lobby1, Factions, Arcade, Anarchy |
| **One** low-value `shop_sell` test | Bulk sells, all players, long live window |
| `shop_sell` earn-only (`can_earn`, not `can_spend`) | `shop_buy`, `gameplay_spend`, `gameplay_earn` |
| Staffed maintenance window | Unattended “leave live on” |

**Lobby1 vote rewards must remain untouched** (jar, config, `can_reward` on `lobby-1`).

---

## Required preconditions (all must pass)

Record evidence links or ticket IDs in the [results template](#11-results-template).

| # | Gate | Evidence doc / check |
|---|------|----------------------|
| 1 | Phase 16 SMP dry-run passed | [ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md](./ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md) (or PR #58) |
| 2 | Phase 17 DB readiness passed | [ECONOMY_DATABASE_READINESS_PHASE17.md](./ECONOMY_DATABASE_READINESS_PHASE17.md) (or PR #59) |
| 3 | Category migration **026** applied in production | Phase 17 § migration inventory |
| 4 | SMP read-only policy **024** applied (`can_read=true`, writes false) | Phase 17 § C |
| 5 | **No** `shop_sell` rows from dry-run | Phase 16 ledger before/after match |
| 6 | `/rf economy gameplay preflight dryrun` → **READY** | Phase 16 command log |
| 7 | SMP TPS/MSPT stable (no ongoing lag incident) | Operator observation |
| 8 | **Explicit operator approval** for live trial | Sign-off in results template |
| 9 | RC jar on SMP from `main` (Phases 13–14+ on `main`, e.g. `9787587…`) | Jar checksum in run log |
| 10 | Rollback SQL + config snippets copied and ready | § [Immediate rollback](#8-immediate-rollback) |

If any gate fails, **do not** run enable SQL or set `dryRun: false`.

---

## 1. Final pre-live checklist

Complete immediately before policy SQL and config flip.

### Jar and backend

- [ ] **Jar commit** recorded: `________________` (sha256: `________________`)
- [ ] Jar installed on **SMP only** — Lobby1 jar unchanged
- [ ] `server.id` = `smp-1`, `server.group` = `smp` (not `anarchy`)
- [ ] **Factions / Arcade / Anarchy** — no jar or economy gameplay config changes

### Evidence on file

- [ ] Phase 16 dry-run: `[GameplaySync:DRYRUN]` log, `queued=0`, ledger `shop_sell` count unchanged
- [ ] Phase 17 DB: category constraint includes `shop_sell`; `smp-1` `can_earn=false`; `lobby-1` `can_reward=true`
- [ ] Rollback SQL block copied (§8 + [ECONOMY_DATABASE_READINESS_PHASE17.md](./ECONOMY_DATABASE_READINESS_PHASE17.md))

### Live trial approval

- [ ] Named operator: `________________`
- [ ] Approval timestamp (UTC): `________________`
- [ ] Incident channel / on-call aware

---

## 2. SQL to enable live shop_sell trial (manual only)

> **Run only after §1 and all preconditions pass.**  
> **SMP only.** Do not change `lobby-1`, `anarchy-1`, `factions-1`, or `arcade-1`.

```sql
-- ═══ MANUAL: SMP live shop_sell earn-only trial ═══
update public.economy_server_policies
set
  enabled = true,
  can_read = true,
  can_reward = false,
  can_earn = true,
  can_spend = false,
  max_credit_minor = 50000,
  max_debit_minor = 0,
  max_batch_count = 100,
  notes = 'SMP live shop_sell ledger trial. Earn-only, capped; no spend/reward.',
  updated_at = now()
where server_id = 'smp-1';
```

Verify immediately:

```sql
select server_id, enabled, can_read, can_reward, can_earn, can_spend,
       max_credit_minor, max_debit_minor, max_batch_count, notes
from public.economy_server_policies
where server_id = 'smp-1';
```

**Expected:** `can_earn=true`, `can_spend=false`, `can_reward=false`, `max_credit_minor=50000`, `max_debit_minor=0`, `max_batch_count=100`.

---

## 3. SMP config for live trial

**SMP `plugins/RealCore/config.yml` only.** Merge; do not copy Lobby1.

```yaml
modules:
  economy: true

economy:
  enabled: true
  gameplaySync:
    enabled: true
    dryRun: false
    backendAllowlist:
      - smp-1
    categories:
      gameplayEarn: false
      gameplaySpend: false
      shopSell: true
      shopBuy: false
    producers:
      economyShopGuiSell:
        enabled: true
        dryRun: false
        logEvents: true
```

**Must stay false / off:** `gameplayEarn`, `gameplaySpend`, `shopBuy`, vote reward settings.

Restart SMP (preferred) or reload per ops standard, then confirm RealCore starts clean.

---

## 4. Preflight live

```text
/rf economy gameplay preflight live
```

### Expected

| Result | Allowed? |
|--------|------------|
| Summary **READY** | Required |
| `WARN dbPolicyWritePermissionNotProven` | Allowed (plugin cannot prove `can_earn` without a write) |
| Any **FAIL** | **Not allowed** — stop and rollback |

Also spot-check:

```text
/rf economy gameplay
/rf economy gameplay producers
```

| Check | Expected |
|-------|----------|
| `gameplaySync` | enabled, **live enqueue** (not dry-run) |
| `shop_sell` | on |
| Producer | enabled, not dry-run |
| Queue | not near capacity; no recent failures |

**If NOT READY:** do not sell-test; § [Immediate rollback](#8-immediate-rollback).

---

## 5. Execute one tiny sell

- [ ] Staff/test account on SMP
- [ ] Sell **one** low-value item via EconomyShopGUI
- [ ] Record:

| Field | Value |
|-------|--------|
| Player name | |
| Player UUID | |
| Item / eventId (from log if available) | |
| Expected `amountMinor` | |
| Sell timestamp (UTC) | |

---

## 6. Expected results

### Player / shop

- [ ] EconomyShopGUI pays **Vault** normally (local sell proceeds unchanged)
- [ ] No double-credit visible to player

### RealCore / writer

- [ ] Producer **captures** event (`captured` +1)
- [ ] Gameplay queue may spike briefly then drain (`queued` → 0)
- [ ] Writer **sends one batch** (`batchesSent` / success counters increment)
- [ ] No sustained failure spam; last HTTP **200** (or duplicate handled cleanly)

### Ledger / balance

- [ ] **Exactly one** new `shop_sell` row for this test (same idempotency key)
- [ ] `economy_balances.balance_minor` for test player increases by **expected** `amountMinor`
- [ ] **No** `vote_reward` row from SMP
- [ ] **No** `shop_buy`, `gameplay_spend`, or `spend` rows from this test
- [ ] **No** duplicate idempotency row (second insert rejected or counted as duplicate)

### Logs

Look for gameplay sync success (not dry-run):

```text
[GameplaySync:QUEUE] ... shop_sell ...
[GameplaySync:BATCH] ... applied=1 ...
```

**Not** `[GameplaySync:DRYRUN]` for this live sell.

---

## 7. Verification SQL

Run after the single sell (read-only except you already ran §2 enable).

### Latest shop_sell rows for SMP

```sql
select
  id,
  minecraft_uuid,
  minecraft_username,
  amount_minor,
  balance_after_minor,
  category,
  idempotency_key,
  source_server_id,
  external_ref_type,
  external_ref_id,
  created_at
from public.economy_ledger
where category = 'shop_sell'
  and source_server_id = 'smp-1'
order by created_at desc
limit 10;
```

### Idempotency — must be one row per sell

```sql
select idempotency_key, count(*) as row_count
from public.economy_ledger
where category = 'shop_sell'
  and source_server_id = 'smp-1'
  and created_at > now() - interval '1 hour'
group by idempotency_key
having count(*) > 1;
```

**Expected:** zero rows.

### Test player balance before/after

Replace UUID:

```sql
select minecraft_uuid, minecraft_username, balance_minor, updated_at
from public.economy_balances
where currency_key = 'realfiction_main'
  and minecraft_uuid = '<test_player_uuid>';
```

Record before/after in results template. Delta should equal sell `amount_minor`.

### Policy state

```sql
select server_id, can_earn, can_spend, can_reward,
       max_credit_minor, max_debit_minor, max_batch_count
from public.economy_server_policies
where server_id = 'smp-1';
```

### No spend / shop_buy from trial

```sql
select category, count(*) as n
from public.economy_ledger
where source_server_id = 'smp-1'
  and category in ('shop_buy', 'gameplay_spend', 'spend', 'gameplay_earn')
  and created_at > now() - interval '1 hour'
group by category;
```

**Expected:** no rows (or unchanged historical counts only).

### vote_reward still Lobby-only

```sql
select source_server_id, count(*) as n
from public.economy_ledger
where category = 'vote_reward'
  and created_at > now() - interval '1 hour'
group by source_server_id;
```

**Expected:** `lobby-1` only (if any recent votes); **not** `smp-1`.

---

## 8. Immediate rollback

If anything is wrong during or after the test:

### Plugin config (SMP)

1. `economy.gameplaySync.dryRun: true`
2. `economy.gameplaySync.producers.economyShopGuiSell.dryRun: true`
3. If needed: `economy.gameplaySync.enabled: false` and producer `enabled: false`
4. Restart SMP (preferred)

### Policy SQL (SMP read-only restore)

```sql
update public.economy_server_policies
set
  enabled = true,
  can_read = true,
  can_reward = false,
  can_earn = false,
  can_spend = false,
  max_credit_minor = 0,
  max_debit_minor = 0,
  max_batch_count = 0,
  notes = 'SMP read-only DB economy access for shadow/alignment rollout.',
  updated_at = now()
where server_id = 'smp-1';
```

### Ledger

- **Do not** delete or update `economy_ledger` / `economy_balances` rows in place.
- Wrong amount or erroneous credit: **compensating** `admin_adjustment` (or reviewed import) only after staff incident review.

### Do not

- Change Lobby1 jar/config
- “Fix” balance by overwriting `economy_balances`
- Enable Factions/Arcade/Anarchy

---

## 9. Stop conditions

Stop the trial immediately (rollback §8) if **any** occur:

| Condition |
|-----------|
| More than one ledger row for a single sell |
| Wrong `amount_minor` vs expected |
| Duplicate idempotency not suppressed (multiple applied rows) |
| Writer failures / retry queue growth / permanent rejects |
| API **400** / **403** / **429** / **500** on economy batch |
| Cloudflare or origin error spike correlated with test |
| Sustained TPS/MSPT degradation |
| EconomyShopGUI **fails** Vault payout |
| SMP creates **`vote_reward`** ledger row |
| **`shop_buy`**, **`spend`**, or **`gameplay_spend`** rows appear |
| **`anarchy-1` / `factions-1` / `arcade-1`** policy changed |
| Preflight live **NOT READY** (any FAIL) |

---

## 10. Post-trial hold

After **one successful** sell and verification:

- [ ] Set `dryRun: true` again on gameplay sync **and** producer **unless** a named short observation window is explicitly approved
- [ ] Do **not** expand to all gameplay categories
- [ ] Do **not** enable `shop_buy` / `gameplay_spend`
- [ ] Do **not** deploy live config to Factions/Arcade/Anarchy
- [ ] Run policy rollback SQL (§8) when observation ends unless Phase 19+ explicitly extends live earn
- [ ] File results template; decide monitoring phase separately
- [ ] If live window continues, begin [ECONOMY_SMP_LIVE_MONITORING_PHASE19.md](./ECONOMY_SMP_LIVE_MONITORING_PHASE19.md)

Default: **return SMP to dry-run or disabled** after the single proof sell, unless Phase 19 monitoring is explicitly approved.

---

## 11. Results template

Copy into ticket / append under “Validation log” in Phase 16 doc.

```markdown
### SMP live shop_sell execution — YYYY-MM-DD

| Field | Value |
|-------|--------|
| **Operator** | |
| **Timestamp (UTC)** | |
| **Jar commit** | |
| **Jar sha256** | |
| **Phase 16 ref** | pass / link |
| **Phase 17 ref** | pass / link |
| **Preflight dryrun** | READY / NOT READY |
| **Preflight live** | READY / NOT READY |
| **Player** | name + UUID |
| **Item sold** | |
| **amountMinor (expected)** | |
| **amountMinor (ledger)** | |
| **Ledger row id** | |
| **Idempotency key** | |
| **Balance before (minor)** | |
| **Balance after (minor)** | |
| **Writer counters** | queued / sent / ok / fail / dup |
| **Rollback needed** | yes / no |
| **Approved for monitoring phase** | yes / no / deferred |

**Notes:**

```

---

## Related docs

| Doc | Role |
|-----|------|
| [ECONOMY_SMP_SHOP_SELL_LIVE_TRIAL.md](./ECONOMY_SMP_SHOP_SELL_LIVE_TRIAL.md) | Trial overview and gates |
| [ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md](./ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md) | Phase 16 |
| [ECONOMY_DATABASE_READINESS_PHASE17.md](./ECONOMY_DATABASE_READINESS_PHASE17.md) | Phase 17 |
| [ECONOMY_GAMEPLAY_PREFLIGHT.md](./ECONOMY_GAMEPLAY_PREFLIGHT.md) | Preflight commands |
| [ECONOMY_GAMEPLAY_OBSERVABILITY.md](./ECONOMY_GAMEPLAY_OBSERVABILITY.md) | Metrics during live window |
| [ECONOMY_SMP_LIVE_MONITORING_PHASE19.md](./ECONOMY_SMP_LIVE_MONITORING_PHASE19.md) | Post-live monitoring window (Phase 19) |
| [ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md](./ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md) | Broader write policy context |
