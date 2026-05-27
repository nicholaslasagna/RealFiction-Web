# SMP EconomyShopGUI Buy Dry-Run Rollout (Phase 23)

Operator plan to validate **`economyShopGuiBuy`** event capture on **SMP only** in
**dry-run mode** with **no DB ledger writes** and **no live debit enqueue**.

This validates buy/spend **event capture only**. EconomyShopGUI and Vault still
handle the real in-game purchase (balance deduction). RealCore only logs
`[GameplaySync:DRYRUN]` lines and increments producer counters for candidate
`shop_buy` events.

**Not in scope:** `can_spend` enablement, `dryRun=false`, Supabase policy changes,
migrations, website deploy, Factions, Arcade, or Anarchy.

**Prerequisite code:** Phase 22 `EconomyShopGuiBuyProducer` merged and installed
on SMP. See [ECONOMY_SHOP_BUY_SPEND_DESIGN_PHASE21.md](ECONOMY_SHOP_BUY_SPEND_DESIGN_PHASE21.md).

---

## 1. Purpose

| What this test does | What it does not do |
|---------------------|---------------------|
| Confirms BUY + SUCCESS + Vault/money events are captured | Write `shop_buy` rows to `economy_ledger` |
| Increments `captured` / `dryRunCaptured` on `economyShopGuiBuy` | Call `/api/plugin/economy/transactions` for gameplay buy |
| Emits `[GameplaySync:DRYRUN] category=shop_buy` logs | Enqueue transactions to `BufferedEconomyTransactionWriter` (`queued` must stay 0) |
| Verifies idempotency and guard rails in production-like SMP load | Change Lobby1 `vote_reward` behavior |

**Vault remains authoritative in-game short-term.** Players must see normal
EconomyShopGUI purchase behavior (money deducted). RealCore must not mutate Vault
for this rollout.

---

## 2. Preconditions

Do not start until **all** of the following are true:

1. **Phase 22** producer skeleton merged to `main` and SMP is running an RC jar
   that includes `EconomyShopGuiBuyProducer`.
2. **SMP** `server.id` is `smp-1` (or matches `backendAllowlist`).
3. **shop_sell** path is stable on SMP (dry-run or live per your current approved
   phase); no unexplained writer failures or error spam from gameplay sync.
4. **No current writer failures** on SMP (`/rf economy gameplay` — no sustained
   gameplay writer fail counters; HTTP 4xx/5xx storms).
5. **TPS/MSPT** stable (no ongoing lag incident).
6. **EconomyShopGUI** (or EconomyShopGUI-Premium) installed and purchases work.
7. Supabase **`can_spend` remains `false`** for `smp-1` (and caps at `0` unless
   separately documented).
8. **`dryRun` remains `true`** globally and on the buy producer.
9. **Lobby1** vote reward ledger writes unchanged (do not alter Lobby jar/config
   for this SMP test).
10. Staff snapshot: SMP `config.yml` economy section, jar path/commit, optional
    `shop_buy` ledger count (SQL below).

---

## 3. SMP dry-run config (buy-only default)

Apply on **SMP backend only**. Merge into `plugins/RealCore/config.yml`.

**Default intent:** buy-only dry-run. Do **not** enable `economyShopGuiSell` unless
you are intentionally testing sell and buy together (document why if you do).

```yaml
modules:
  economy: true

economy:
  enabled: true
  gameplaySync:
    enabled: true
    dryRun: true
    backendAllowlist:
      - smp-1
    categories:
      gameplayEarn: false
      gameplaySpend: false
      shopSell: false
      shopBuy: true
    producers:
      economyShopGuiBuy:
        enabled: true
        category: shop_buy
        dryRun: true
        logEvents: true
        maxEventsPerFlush: 250
```

### Must stay true

```yaml
economy:
  gameplaySync:
    dryRun: true
    producers:
      economyShopGuiBuy:
        dryRun: true
```

### Must stay false

- `categories.shopSell` — unless dual test (not default)
- `categories.gameplaySpend`
- Supabase `can_spend` for `smp-1`
- `economy.gameplaySync.dryRun: false`
- `producers.economyShopGuiBuy.dryRun: false`

### Why no `can_spend=true` is required

Dry-run capture stops before the gameplay buffer enqueues to the writer. No
`apply_economy_batch` RPC should run for `shop_buy` during this test.

---

## 4. Commands

Run on SMP as staff with `realcore.admin`.

| Step | Command |
|------|---------|
| Baseline | `/rf economy` |
| Gameplay sync | `/rf economy gameplay` |
| Producer metrics (before buy) | `/rf economy gameplay producers` |
| Preflight | `/rf economy gameplay preflight dryrun` |

### Expected preflight / status (dry-run)

| Check | Expected |
|-------|----------|
| Preflight summary | **DRY-RUN READY** (or equivalent pass for dry-run mode) |
| `economyShopGuiBuy` | **enabled**, producer dry-run **on** |
| `shopBuy` category | **enabled** |
| `gameplaySync.dryRun` | **true** |
| `economyShopGuiBuy` hook | `listening for PostTransactionEvent (BUY)` when EconomyShopGUI present |
| `queued` (buy metrics) | **0** before test |
| Writer / API | No gameplay transaction sends; API probe may be skipped or read-only |
| Failures | No new error spam |

Record baseline from `/rf economy gameplay producers`:

- **economyShopGuiBuy:** `captured`, `dryRunCaptured`, `queued`, `duplicateRejected`, `invalidRejected`, `overCapRejected`

---

## 5. Test one tiny buy

1. Use a staff alt or test account with a small Vault balance.
2. Buy a **very low-cost** item through EconomyShopGUI (single unit if possible).
3. Confirm the GUI completes successfully (item received).

### Expected behavior

| Layer | Expected |
|-------|----------|
| EconomyShopGUI / Vault | Player balance **decreases** normally; item granted |
| RealCore log | `[GameplaySync:DRYRUN] ... category=shop_buy ... amountMinor=... source=EconomyShopGUI` |
| `economyShopGuiBuy` metrics | `captured` and `dryRunCaptured` increment by ≥ 1 |
| `queued` | **Unchanged (0)** |
| HTTP / API | **No** economy transaction batch from gameplay buy path |
| Supabase | **No** new `shop_buy` ledger row |

Re-run:

```
/rf economy gameplay producers
```

---

## 6. Supabase verification SQL

Run in Supabase SQL Editor **before** and **after** the buy test. Read-only.

### Count `shop_buy` rows

```sql
select count(*) as shop_buy_count
from public.economy_ledger
where category = 'shop_buy';
```

**Expected:** count **unchanged** during dry-run.

### Recent debit-category rows

```sql
select *
from public.economy_ledger
where category in ('shop_buy', 'gameplay_spend', 'spend')
order by created_at desc
limit 20;
```

**Expected:** no new rows from this SMP dry-run test.

### SMP policy still read-only (optional)

```sql
select
  server_id,
  can_read,
  can_earn,
  can_spend,
  max_debit_minor
from public.economy_server_policies
where server_id = 'smp-1';
```

**Expected:** `can_spend = false`, `max_debit_minor = 0` (unless a separate approved change exists).

---

## 7. Stop conditions

Rollback immediately if **any** of the following occur:

| Condition | Action |
|-----------|--------|
| New `shop_buy` (or `gameplay_spend` / `spend`) ledger rows | Roll back SMP config; incident review |
| `queued` increments on `economyShopGuiBuy` during dry-run | Roll back |
| Evidence of writer sending gameplay transactions | Roll back |
| Player Vault balance does **not** deduct on a successful GUI buy | Roll back; treat as gameplay bug, not DB sync |
| Cancelled/failed buys increment `captured` | Roll back; producer filter regression |
| `duplicateRejected` spikes without purchases | Roll back |
| Error spam (reflection, NPE, repeated `[GameplaySync:ERROR]`) | Roll back |
| Sustained TPS/MSPT degradation correlated with test | Roll back |
| Any non-SMP server receives this config | Roll back all affected servers |
| Lobby1 vote reward behavior changes | Roll back SMP; verify Lobby1 |

---

## 8. Rollback

1. Set `economy.gameplaySync.producers.economyShopGuiBuy.enabled: false`.
2. Set `economy.gameplaySync.categories.shopBuy: false`.
3. Keep `economy.gameplaySync.dryRun: true` (and producer `dryRun: true`).
4. Reload RealCore or **restart SMP** (prefer restart).
5. Re-run Supabase count SQL to confirm no new debit-category rows after rollback window.

**No DB rollback** is required if dry-run behaved correctly (no ledger rows written).

If accidental live writes occurred, follow staff incident procedure; do not run ad-hoc
balance overwrites without approval.

---

## 9. Explicit warnings

- **Do not** enable `can_spend` in Supabase for this test.
- **Do not** set `dryRun: false` on gameplay sync or `economyShopGuiBuy`.
- **Do not** test on **Factions**, **Arcade**, or **Anarchy**.
- **Do not** treat Vault balance polling / shadow reads as purchase reconciliation.
- **Do not** disable Lobby1 vote reward fallback or change vote ledger settings as part of this SMP test.
- **Do not** enable live `shop_sell` and `shop_buy` live writes in the same window without a written plan.
- **Do not** deploy website, Cloudflare, or migration changes for this ops test.

---

## 10. Results template

Copy for each test session:

```markdown
## SMP shop_buy dry-run result

- **Operator:**
- **Timestamp (UTC):**
- **Jar / git commit:**
- **SMP server.id:**
- **Test player (UUID):**
- **Item purchased:**
- **Expected amountMinor (from log):**
- **Preflight:** `/rf economy gameplay preflight dryrun` → (READY / NOT READY)
- **Dry-run log line:** (paste `[GameplaySync:DRYRUN]` line)
- **shop_buy count before:**
- **shop_buy count after:**
- **economyShopGuiBuy queued before / after:**
- **economyShopGuiBuy captured / dryRunCaptured after:**
- **Vault deduction normal:** yes / no
- **Rollback needed:** yes / no
- **Approved for live buy trial:** yes / no (requires separate phase; NOT this rollout)
```

---

## Success criteria

- [ ] Phase 22 jar on SMP without startup errors
- [ ] Preflight dry-run **READY**
- [ ] One tiny buy produces `[GameplaySync:DRYRUN] category=shop_buy`
- [ ] `economyShopGuiBuy` `captured` / `dryRunCaptured` increment; `queued` stays 0
- [ ] `shop_buy` ledger count unchanged in Supabase
- [ ] `can_spend` still false for `smp-1`
- [ ] Vault purchase behavior normal for players
- [ ] Lobby1 vote rewards unaffected

## Related docs

- [ECONOMY_SHOP_BUY_SPEND_DESIGN_PHASE21.md](ECONOMY_SHOP_BUY_SPEND_DESIGN_PHASE21.md) — debit design and Phase 22 skeleton
- [ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md](ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md) — producer defaults and hooks
- [ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md](ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md) — sell-side dry-run (Phase 10)
- [ECONOMY_GAMEPLAY_PREFLIGHT.md](ECONOMY_GAMEPLAY_PREFLIGHT.md) — preflight command reference
- [GAMEPLAY_ECONOMY_SYNC_DESIGN.md](GAMEPLAY_ECONOMY_SYNC_DESIGN.md) — full phase plan
