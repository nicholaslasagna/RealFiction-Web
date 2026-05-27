# SMP Shop Sell + Buy Combined Monitoring (Phase 25)

Operator monitoring plan for running **`shop_sell`** (earn) and **`shop_buy`** (spend)
together on **SMP (`smp-1`)** after each category’s **single-event live trial** has
passed separately.

**This document does not** change code, run SQL, deploy jars, or flip production
config. Staff execute monitoring manually after explicit approval.

**Prerequisites:**

- [ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md](ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md) passed; single sell live trial completed (see [ECONOMY_SMP_SHOP_SELL_LIVE_TRIAL.md](ECONOMY_SMP_SHOP_SELL_LIVE_TRIAL.md) or staff runbook).
- [ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md](ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md) passed; [ECONOMY_SMP_SHOP_BUY_LIVE_TRIAL.md](ECONOMY_SMP_SHOP_BUY_LIVE_TRIAL.md) single-buy trial passed.
- Authority model understood: [ECONOMY_AUTHORITY_MODEL_PHASE20.md](ECONOMY_AUTHORITY_MODEL_PHASE20.md) (Vault authoritative in-game short-term; DB ledger for approved events).

---

## 1. Purpose

Validate SMP **earn and spend together** under capped policy:

| Validate | How |
|----------|-----|
| `shop_sell` credits | Ledger rows positive; Vault sell payouts normal |
| `shop_buy` debits | Ledger rows negative; Vault purchase deductions normal |
| Idempotency | No duplicate keys per economic fact |
| Batching | Batches within `max_batch_count`; flush intervals sane |
| Queue safety | Near-zero depth; no overflow drops |
| DB/Vault drift | Sampled players; drift documented, not auto-fixed |
| Cloudflare / API usage | No 403/429/5xx storms; request rate acceptable |
| No duplicate credits/debits | SQL dup checks + producer `duplicateRejected` stable |

**Lobby1 `vote_reward` must remain untouched.** No Factions, Arcade, or Anarchy.

---

## 2. Allowed scope

### In scope (SMP only)

| Dimension | Allowed value |
|-----------|----------------|
| `server_id` | `smp-1` only |
| Categories | `shop_sell`, `shop_buy` only |
| `can_earn` | `true` |
| `can_spend` | `true` |
| `max_credit_minor` | `50000` ($500.00) |
| `max_debit_minor` | `50000` ($500.00) |
| `max_batch_count` | `100` |
| Producers | `economyShopGuiSell`, `economyShopGuiBuy` |

### Still excluded

- `gameplay_earn` / `gameplay_spend` generic categories (unless a **separate** approved phase)
- Legacy `spend` category trials
- **Factions**, **Arcade**, **Anarchy** gameplay sync
- Automatic Vault↔DB reconciliation or balance overwrites
- DB-backed Vault provider rollout
- Vote reward path changes on Lobby1

---

## 3. Combined config example

SMP `plugins/RealCore/config.yml` intent (apply manually after approval):

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
      shopBuy: true
    producers:
      economyShopGuiSell:
        enabled: true
        category: shop_sell
        dryRun: false
        logEvents: true
        maxEventsPerFlush: 250
      economyShopGuiBuy:
        enabled: true
        category: shop_buy
        dryRun: false
        logEvents: true
        maxEventsPerFlush: 250
```

Align `flushSeconds`, `maxBatchSize`, and observability limits with
[ECONOMY_GAMEPLAY_OBSERVABILITY.md](ECONOMY_GAMEPLAY_OBSERVABILITY.md).

---

## 4. Policy SQL (manual only)

Run in Supabase **only after** combined-mode approval. **Do not run from CI or this repo.**

```sql
update public.economy_server_policies
set
  enabled = true,
  can_read = true,
  can_reward = false,
  can_earn = true,
  can_spend = true,
  max_credit_minor = 50000,
  max_debit_minor = 50000,
  max_batch_count = 100,
  notes = 'SMP combined shop_sell/shop_buy monitoring. Capped earn/spend; no rewards.',
  updated_at = now()
where server_id = 'smp-1';
```

Verify exactly one row updated. Confirm `can_reward = false`.

Rollback policy snippet is in §10.

---

## 5. Monitoring window

| Guideline | Recommendation |
|-----------|----------------|
| Minimum duration | **24 hours** continuous monitoring |
| Preferred | **Several days** (72h+) with routine SQL + command checks |
| Player load | Start with **low concurrent count**; avoid peak launch day |
| Staffing | **Staff online first hour** after enabling combined live mode |
| Check cadence | Hourly first 6h, then every 12h, then daily |

Record jar commit, config hash, and policy `updated_at` at window start.

---

## 6. Required checks

### Commands (SMP, `realcore.admin`)

```
/rf economy
/rf economy gameplay
/rf economy gameplay producers
/rf economy gameplay preflight live
```

### Expected (healthy window)

| Signal | Expected |
|--------|----------|
| Preflight summary | **READY** |
| FAIL checks | **None** |
| `economyShopGuiSell` / `economyShopGuiBuy` | Both enabled, `dryRun=false`, hooks listening |
| Gameplay queue depth | **Near zero** between flushes |
| Retry depth | **Near zero**; no sustained growth |
| Overflow / drops | **0** or rare isolated drops with documented cause |
| `duplicateRejected` | Low; no storm |
| Permanent rejects | **0** or investigated single events |
| Writer gameplay counters | `gameplaySucceeded` tracks activity; `gameplayFailures` flat |
| Vote rewards | Unchanged on Lobby1; no SMP `vote_reward` rows |

Capture screenshots or log excerpts at window start, +1h, +24h, and end.

See [ECONOMY_GAMEPLAY_OBSERVABILITY.md](ECONOMY_GAMEPLAY_OBSERVABILITY.md) for metric names.

---

## 7. SQL monitoring (manual, read-only)

Run in Supabase on a schedule during the window. Replace time intervals as needed.

### Count by category (SMP, window)

```sql
select category, count(*) as n, sum(amount_minor) as net_minor
from public.economy_ledger
where source_server_id = 'smp-1'
  and created_at > now() - interval '24 hours'
group by category
order by category;
```

**Expected:** only `shop_sell` and `shop_buy` (plus pre-existing non-gameplay history).

### Latest sell/buy rows

```sql
select id, category, amount_minor, minecraft_uuid, idempotency_key, created_at
from public.economy_ledger
where source_server_id = 'smp-1'
  and category in ('shop_sell', 'shop_buy')
order by created_at desc
limit 30;
```

### Duplicate idempotency keys

```sql
select idempotency_key, category, count(*) as row_count
from public.economy_ledger
where source_server_id = 'smp-1'
  and category in ('shop_sell', 'shop_buy')
  and created_at > now() - interval '24 hours'
group by idempotency_key, category
having count(*) > 1;
```

**Expected:** no rows.

### Largest credits and debits

```sql
select id, category, amount_minor, minecraft_uuid, idempotency_key, created_at
from public.economy_ledger
where source_server_id = 'smp-1'
  and category = 'shop_sell'
  and created_at > now() - interval '24 hours'
order by amount_minor desc
limit 10;

select id, category, amount_minor, minecraft_uuid, idempotency_key, created_at
from public.economy_ledger
where source_server_id = 'smp-1'
  and category = 'shop_buy'
  and created_at > now() - interval '24 hours'
order by amount_minor asc
limit 10;
```

Confirm magnitudes ≤ policy caps per transaction.

### Net DB movement by player (sample)

```sql
select
  minecraft_uuid,
  sum(case when category = 'shop_sell' then amount_minor else 0 end) as sell_minor,
  sum(case when category = 'shop_buy' then amount_minor else 0 end) as buy_minor,
  sum(amount_minor) as net_minor,
  count(*) as tx_count
from public.economy_ledger
where source_server_id = 'smp-1'
  and category in ('shop_sell', 'shop_buy')
  and created_at > now() - interval '24 hours'
group by minecraft_uuid
order by tx_count desc
limit 20;
```

### No `vote_reward` from SMP

```sql
select count(*) as smp_vote_rewards
from public.economy_ledger
where source_server_id = 'smp-1'
  and category = 'vote_reward'
  and created_at > now() - interval '24 hours';
```

**Expected:** `0`.

### No Factions / Arcade / Anarchy gameplay rows

```sql
select source_server_id, category, count(*) as n
from public.economy_ledger
where category in ('shop_sell', 'shop_buy', 'gameplay_earn', 'gameplay_spend', 'spend')
  and created_at > now() - interval '24 hours'
  and source_server_id not in ('smp-1')
group by source_server_id, category
order by source_server_id, category;
```

**Expected:** no new rows from non-SMP servers (or only historical unrelated rows outside window).

### Unexpected categories on SMP

```sql
select category, count(*) as n
from public.economy_ledger
where source_server_id = 'smp-1'
  and created_at > now() - interval '24 hours'
group by category
order by category;
```

### Policy state

```sql
select server_id, enabled, can_reward, can_earn, can_spend,
       max_credit_minor, max_debit_minor, max_batch_count, notes, updated_at
from public.economy_server_policies
where server_id = 'smp-1';
```

---

## 8. Drift sampling

Pick **3–5 sample players** who both sold and bought during the window (include one staff test account).

For each sample:

| Reading | Source |
|---------|--------|
| Vault balance | In-game `/balance` or Essentials |
| DB balance | `economy_balances.balance_minor` or website |
| Recent ledger net | Sum `shop_sell` + `shop_buy` in window |

**Document expected differences:** Vault and DB will not match exactly short-term
(Option B). Note direction and magnitude; do **not** auto-reconcile.

| Drift type | Action |
|------------|--------|
| Small, stable, explainable | Log and continue monitoring |
| Growing without shop activity | **Stop** (§9) |
| DB moved, Vault did not (or reverse) on recent trade | **Stop**; incident review |

Do not run `admin_import_economy_balances` or mass adjustments during monitoring.

---

## 9. Stop conditions

Stop combined monitoring and roll back (§10) if **any** occur:

| Condition |
|-----------|
| Duplicate **credit** (`shop_sell`) for one sell |
| Duplicate **debit** (`shop_buy`) for one buy |
| Wrong `amount_minor` vs GUI price |
| Cancelled/failed buy recorded |
| Missed sell or buy (player trade with no ledger row) |
| DB/Vault drift **grows** unexpectedly on samples |
| Queue overflow or sustained retry growth |
| Repeated API **400 / 403 / 429 / 500** |
| Cloudflare usage spike tied to economy plugin |
| TPS/MSPT degradation correlated with gameplay sync |
| Ledger rows on **non-SMP** servers |
| **Lobby1 vote rewards** affected |
| Unexpected categories (`gameplay_spend`, `vote_reward` on SMP, etc.) |
| Player money complaints tied to shop sync |

---

## 10. Rollback

### Plugin (SMP)

1. `economy.gameplaySync.dryRun: true`
2. `economyShopGuiSell.enabled: false`, `economyShopGuiBuy.enabled: false` (and producer `dryRun: true`)
3. `shopSell: false`, `shopBuy: false`
4. Restart SMP (prefer full restart)

### Policy (manual SQL)

```sql
update public.economy_server_policies
set
  can_earn = false,
  can_spend = false,
  max_credit_minor = 0,
  max_debit_minor = 0,
  notes = 'Rollback: SMP combined shop monitoring stopped.',
  updated_at = now()
where server_id = 'smp-1';
```

Restore full read-only SMP policy per
[ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md](ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md) if required.

### Ledger

- **Preserve** all ledger rows written during monitoring.
- **`admin_adjustment`** compensations only after manual incident review.

---

## 11. Success criteria

Ready for the **next phase** (broader SMP gameplay, other backends, or policy
tuning) **only if all** hold for the full monitoring window:

- [ ] Stable **several days** with no stop-condition triggers
- [ ] **No duplicate** idempotency keys for `shop_sell` / `shop_buy`
- [ ] **No unauthorized categories** on SMP in window
- [ ] **No policy violations** (caps respected; `can_reward` still false)
- [ ] **No credible player money complaints** tied to sync
- [ ] **No queue drops** / sustained writer failures
- [ ] **Cloudflare / API usage** acceptable to ops
- [ ] **SMP performance** stable (TPS/MSPT)
- [ ] Drift samples **documented** and bounded
- [ ] Lobby1 vote rewards **unchanged**

Sign-off: operator lead + economy owner (names in run log).

---

## Next phase (after shop monitoring sign-off)

Generic `gameplay_earn` / `gameplay_spend` (quests, events, fees) — design only until
shop path is stable:
[ECONOMY_GENERIC_GAMEPLAY_EARN_SPEND_DESIGN_PHASE26.md](ECONOMY_GENERIC_GAMEPLAY_EARN_SPEND_DESIGN_PHASE26.md).

## Related docs

- [GAMEPLAY_ECONOMY_SYNC_DESIGN.md](GAMEPLAY_ECONOMY_SYNC_DESIGN.md)
- [ECONOMY_SMP_SHOP_SELL_LIVE_TRIAL.md](ECONOMY_SMP_SHOP_SELL_LIVE_TRIAL.md)
- [ECONOMY_SMP_SHOP_BUY_LIVE_TRIAL.md](ECONOMY_SMP_SHOP_BUY_LIVE_TRIAL.md)
- [ECONOMY_AUTHORITY_MODEL_PHASE20.md](ECONOMY_AUTHORITY_MODEL_PHASE20.md)
- [ECONOMY_GENERIC_GAMEPLAY_EARN_SPEND_DESIGN_PHASE26.md](ECONOMY_GENERIC_GAMEPLAY_EARN_SPEND_DESIGN_PHASE26.md)
- [ECONOMY_GAMEPLAY_OBSERVABILITY.md](ECONOMY_GAMEPLAY_OBSERVABILITY.md)
- [ECONOMY_GAMEPLAY_PREFLIGHT.md](ECONOMY_GAMEPLAY_PREFLIGHT.md)
