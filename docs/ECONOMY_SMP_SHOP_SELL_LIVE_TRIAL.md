# SMP EconomyShopGUI Sell Live Ledger Trial (Phase 12)

Operator plan to enable **real** `shop_sell` ledger writes on **SMP only**
(`server_id: smp-1`) after Phase 10 dry-run passes.

This document is **manual ops only**. It does not run SQL, deploy jars, or change
production config automatically.

## Scope

| In scope | Out of scope |
|----------|----------------|
| `smp-1` earn-only policy for `shop_sell` | `lobby-1`, `factions-1`, `arcade-1`, `anarchy-1` |
| EconomyShopGUI sell producer live enqueue | `shop_buy`, `gameplay_spend`, `gameplay_earn` categories |
| One-server capped trial (`max_credit_minor: 50000`) | Factions / Arcade / Anarchy rollout |
| Observation of DB + Vault double-credit risk | Vault provider, full authority model, historical reconcile |

**Prerequisite:** complete [ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md](ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md) on the RC jar built from `main`.

---

## Critical double-credit warning

During this trial, **EconomyShopGUI still pays Vault locally** (EssentialsX /
Vault) **and** RealCore records a **DB ledger earn** for the same sell.

That means:

- DB `economy_balances` and SMP Vault balances may **both** increase for the same
  sell event.
- This is acceptable **only** as a bounded observation / trial step.
- **Do not** treat this as production-ready economy authority.
- **Do not** use this trial to reconcile all historical Vault ↔ DB drift.
- **Do not** enable broad production or other backends until the long-term sync
  model (Vault provider or controlled bridge) is reviewed.

---

## Preconditions (all required)

Before enabling live writes:

### Dry-run gate (Phase 10)

- [ ] Dry-run test completed on SMP with RC jar from `main`
- [ ] `[GameplaySync:DRYRUN]` log line observed for at least one small sell
- [ ] `captured` and `dryRunCaptured` incremented on `/rf economy gameplay producers`
- [ ] **`queued` remained 0** for the entire dry-run window
- [ ] **No** new `shop_sell` rows in `economy_ledger` during dry-run
- [ ] EconomyShopGUI Vault payout still worked for the test sell
- [ ] SMP TPS/MSPT stable during dry-run (no sustained degradation)
- [ ] No error spam from producer hook / reflection

### Database and policy

- [ ] Phase 6 migration `202605270026_economy_transaction_categories.sql` applied
- [ ] Phase 5 SMP read-only policy was applied before dry-run (`smp-1` readable, writes off)
- [ ] Operator confirms **SMP-only** trial — no jar/config/SQL changes on Lobby1, Factions, Arcade, or Anarchy

### RealCore / ops

- [ ] RC jar installed on SMP (same jar that passed dry-run, or newer `main` build with same checks)
- [ ] Staff have read [REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md](REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md)
- [ ] Snapshots taken: SMP `config.yml` economy section, current jar, Supabase policy row, baseline ledger counts

### Lobby1 vote rewards (do not change)

- [ ] Lobby1 jar and vote reward config **unchanged** as part of this trial
- [ ] `voteRewardsLedgerWritesEnabled` / fallback on Lobby1 not modified for SMP work

---

## Dry-run pass criteria (summary)

If any item failed during dry-run, **do not proceed** — fix or roll back dry-run
config first.

| Signal | Pass |
|--------|------|
| `dryRunCaptured` | Increased after sell |
| `queued` | **0** throughout |
| `economy_ledger` `shop_sell` | Count unchanged |
| Vault sell proceeds | Player received money |
| `vote_reward` from SMP | None created |
| SMP policy | `can_earn=false`, `can_spend=false` |

---

## Enable order (manual)

Apply in this order after preconditions pass:

1. **Supabase:** run enable SQL below (policy only).
2. **Verify policy** with verification SQL.
3. **SMP config:** apply live config below (`dryRun: false` for sync + producer).
4. **Restart SMP** (preferred) or reload RealCore per ops standard.
5. **In-game checks:** `/rf economy`, `/rf economy gameplay`, `/rf economy gameplay producers`.
6. **One small sell** (low value item).
7. **Post-sell verification:** commands + Supabase SQL below.

Do **not** enable live config before policy SQL, or writes will be rejected by RPC.

---

## 1. Enable SQL (manual only — SMP `smp-1` only)

Run in Supabase SQL Editor. **Not** a migration. **Not** `supabase db push`.

```sql
update public.economy_server_policies
set
  server_group = 'smp',
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
where server_id = 'smp-1'
  and server_group = 'smp';
```

### Do not touch

| `server_id` | Action |
|-------------|--------|
| `lobby-1` | **No change** (vote rewards live) |
| `anarchy-1` | **No change** |
| `factions-1` | **No change** |
| `arcade-1` | **No change** |

---

## 2. Rollback SQL (read-only SMP policy)

Run immediately on stop conditions or end of trial.

```sql
update public.economy_server_policies
set
  server_group = 'smp',
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
where server_id = 'smp-1'
  and server_group = 'smp';
```

Incorrect ledger rows from the trial require **compensating append-only** admin
entries — never direct balance overwrites. See staff incident procedure.

---

## 3. SMP live config (operator merge)

Apply on **SMP only** (`server.id: smp-1`). Merge into existing
`plugins/RealCore/config.yml`.

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

### Config rules

- **Both** `gameplaySync.dryRun` and `producers.economyShopGuiSell.dryRun` must be `false` for live enqueue.
- Keep `gameplayEarn`, `gameplaySpend`, and `shopBuy` **false**.
- Do **not** change Lobby1 economy or vote reward keys.
- Do **not** set `can_spend=true` in Supabase for this trial.

---

## 4. Command checks (exact)

Run on SMP as staff with `realcore.admin`.

### Before sell (after config + policy enable)

```
/rf economy
```

Confirm global economy writer can run (enabled, not read-only guard blocking mutations for gameplay path).

```
/rf economy gameplay
```

Expected:

- `Gameplay sync: enabled` (not dry-run)
- `shop_sell=on`; other categories off
- Allowlist includes `smp-1`

```
/rf economy gameplay producers
```

Record baseline: `captured`, `queued`, `duplicateRejected`, writer-related counters.

### After one small sell

```
/rf economy gameplay producers
```

```
/rf economy
```

Check writer batch counters (sent / failed) if shown.

### Log lines

Live path may log:

```text
[GameplaySync:QUEUE] server=smp-1 category=shop_sell ...
```

Dry-run `[GameplaySync:DRYRUN]` should **not** appear for new sells after live enable.

---

## 5. Verification SQL (Supabase)

Run **before** enable, **after** policy enable, and **after** test sell.

### 5.1 Policy state (`smp-1` and other backends)

```sql
select
  server_id,
  server_group,
  enabled,
  can_read,
  can_reward,
  can_earn,
  can_spend,
  max_credit_minor,
  max_debit_minor,
  max_batch_count,
  notes,
  updated_at
from public.economy_server_policies
order by server_id;
```

**Expected for live trial (`smp-1`):**

| Field | Value |
|-------|--------|
| `enabled` | `true` |
| `can_read` | `true` |
| `can_reward` | `false` |
| `can_earn` | `true` |
| `can_spend` | `false` |
| `max_credit_minor` | `50000` |
| `max_debit_minor` | `0` |
| `max_batch_count` | `100` |

**Expected unchanged:** `lobby-1` still has `can_reward=true` for votes; `anarchy-1` disabled; `factions-1` / `arcade-1` not expanded for this trial.

### 5.2 `shop_sell` row count (before / after)

```sql
select count(*) as shop_sell_count
from public.economy_ledger
where category = 'shop_sell';
```

Record `shop_sell_count_before`. After one sell, expect **`+1`** (not more).

### 5.3 Latest `shop_sell` rows for SMP

```sql
select
  id,
  minecraft_uuid,
  minecraft_username,
  amount_minor,
  balance_after_minor,
  category,
  reason,
  idempotency_key,
  source,
  source_server_id,
  source_server_group,
  external_ref_type,
  external_ref_id,
  created_at
from public.economy_ledger
where category = 'shop_sell'
  and source_server_id = 'smp-1'
order by created_at desc
limit 20;
```

**Expected for one test sell:**

- Exactly **one** new row for that sell event (after baseline).
- `amount_minor > 0` (credit).
- `source_server_id = 'smp-1'`.
- `idempotency_key` like `gameplay:smp-1:shop_sell:economyshopgui:<uuid>:<eventId>`.

### 5.4 Duplicate idempotency keys

```sql
select
  idempotency_key,
  count(*) as row_count
from public.economy_ledger
where category = 'shop_sell'
  and source_server_id = 'smp-1'
  and created_at > now() - interval '24 hours'
group by idempotency_key
having count(*) > 1;
```

**Expected:** empty result (no duplicate keys for the same sell).

### 5.5 Batch / failure indicators (`smp-1`)

```sql
select
  batch_id,
  server_id,
  submitted_count,
  applied_count,
  duplicate_count,
  status,
  created_at
from public.economy_transaction_batches
where server_id = 'smp-1'
order by created_at desc
limit 20;
```

After a successful sell flush, expect a recent batch with `status = 'applied'`,
`applied_count >= 1`, and no unexplained burst of failed batches.

If batches show `applied_count = 0` while ledger rows appear, or repeated
submissions without applied rows, **stop and rollback**.

### 5.6 Test player balance (DB canonical)

Replace `<minecraft_uuid>` with the test account UUID (lowercase).

```sql
select
  currency_key,
  minecraft_uuid,
  minecraft_username,
  balance_minor,
  version,
  updated_at
from public.economy_balances
where currency_key = 'realfiction_main'
  and minecraft_uuid = '<minecraft_uuid>';
```

Record balance **before** sell. After sell, `balance_minor` should increase by
the sell `amount_minor` (if this was the player's first gameplay credit, row may
be inserted).

### 5.7 Vote rewards still Lobby-only

```sql
select
  source_server_id,
  category,
  count(*) as row_count
from public.economy_ledger
where category = 'vote_reward'
  and created_at > now() - interval '24 hours'
group by source_server_id, category
order by source_server_id;
```

**Expected:** `vote_reward` rows from **`lobby-1`** (or historical imports), **not** `smp-1`.

```sql
select count(*) as smp_vote_reward_rows
from public.economy_ledger
where category = 'vote_reward'
  and source_server_id = 'smp-1'
  and created_at > now() - interval '7 days';
```

**Expected:** `0`.

### 5.8 No spend / shop_buy from SMP during trial

```sql
select category, count(*) as row_count
from public.economy_ledger
where source_server_id = 'smp-1'
  and created_at > now() - interval '24 hours'
  and category in ('gameplay_spend', 'shop_buy', 'spend', 'gameplay_earn')
group by category;
```

**Expected:** empty (only `shop_sell` gameplay category for SMP in this trial).

---

## 6. Expected behavior after one small sell

### Producer (`/rf economy gameplay producers`)

| Metric | Expected |
|--------|----------|
| `captured` | Increments |
| `queued` | May increment briefly, then flush |
| `dryRunCaptured` | No new increments after live enable |
| `duplicateRejected` | 0 for a single sell (unless event retried) |
| Hook | `listening for PostTransactionEvent (SELL)` |

### Writer (`/rf economy`)

- Writer **success** / sent batch counters increase after flush interval.
- No sustained growth of failed batches.

### Ledger

- **One** `shop_sell` row for the sell.
- `economy_balances.balance_minor` increases by sell amount for that player.
- **No** `vote_reward` rows from `smp-1`.
- **No** `shop_buy`, `gameplay_spend`, or `gameplay_earn` rows from SMP.

### Vault (local)

- Player still receives EconomyShopGUI Vault payout **normally**.
- DB balance and Vault balance may **both** go up (see double-credit warning).

### API

- Gameplay path posts to `/api/plugin/economy/transactions` via existing HMAC
  plugin client (same as vote rewards infrastructure).
- **No** service role keys on game servers; **no** auth/HMAC changes in this phase.

---

## 7. Stop conditions

Stop immediately, **rollback config and SQL**, and escalate if **any** of:

| Condition | Action |
|-----------|--------|
| More than **one** ledger row per distinct sell | Rollback; investigate dedup |
| Duplicate `idempotency_key` rows for same sell | Rollback |
| SMP creates `vote_reward` ledger rows | Rollback; verify policy |
| `shop_buy`, `gameplay_spend`, or `gameplay_earn` rows from SMP | Rollback |
| `max_credit_minor` rejects normal small sells | Rollback; review cap |
| Writer / batch failures or stuck queue | Rollback |
| Cloudflare / API request volume spike from SMP | Rollback |
| SMP TPS/MSPT sustained degradation | Rollback |
| Vault stops paying on EconomyShopGUI sells | Rollback jar/config |
| `lobby-1`, `anarchy-1`, `factions-1`, or `arcade-1` policy changed | Rollback; audit who changed |
| Accidental enable on non-SMP backends | Rollback all affected |

---

## 8. Rollback process (config + SQL)

1. **SMP config:** set `economy.gameplaySync.enabled: false` and `economy.gameplaySync.producers.economyShopGuiSell.enabled: false` (or restore backup `config.yml`).
2. **Supabase:** run rollback SQL (section 2).
3. **Restart SMP** (preferred) or reload RealCore.
4. Re-run verification SQL: `smp-1` read-only, no new `shop_sell` after rollback window.
5. If jar behavior is wrong, restore previous RealCore jar from backup.

Ledger rows already written remain append-only; use compensating entries only if
staff approves correction.

---

## 9. Expected ledger row shape (reference)

Example fields for one successful sell (values illustrative):

| Field | Example |
|-------|---------|
| `category` | `shop_sell` |
| `amount_minor` | `125` |
| `source_server_id` | `smp-1` |
| `source_server_group` | `smp` |
| `source` | `plugin` |
| `idempotency_key` | `gameplay:smp-1:shop_sell:economyshopgui:<uuid>:<eventId>` |
| `reason` | Producer-provided sell reason string |

---

## 10. Explicit forbidden actions

- No Java changes unless fixing a dry-run bug found in RC
- No new migrations or `supabase db push` for this trial
- No automatic SQL execution from CI or scripts
- No jar deploy as part of authoring this doc
- No `can_spend=true` on `smp-1`
- No `shop_buy` / `gameplay_spend` producers
- No vote reward config changes on Lobby1
- No HMAC / auth changes
- No service role exposure on backends
- No direct `economy_balances` overwrites
- No Factions / Arcade / Anarchy rollout

---

## Related docs

- [ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md](ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md) — required first step
- [REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md](REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md) — RC build and merge order
- [GAMEPLAY_ECONOMY_SYNC_DESIGN.md](GAMEPLAY_ECONOMY_SYNC_DESIGN.md) — phase index
- [ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md](ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md) — producer behavior
- [ECONOMY_TRANSACTION_CATEGORIES.md](ECONOMY_TRANSACTION_CATEGORIES.md) — `shop_sell` policy mapping
