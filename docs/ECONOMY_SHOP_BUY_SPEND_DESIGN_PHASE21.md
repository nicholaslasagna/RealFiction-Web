# Shop buy and spend path design (Phase 21)

Design and rollout plan for **debit-side** gameplay economy ledger events:
`shop_buy`, `gameplay_spend`, and legacy `spend`.

**Scope:** Docs/design only. No Java, migrations, policy changes, deploy, or
`can_spend` enablement in this phase.

**Authority context:** Short-term **Option B** (plugin hooks); Vault authoritative
in-game; DB ledger records approved events. See
[ECONOMY_AUTHORITY_MODEL_PHASE20.md](./ECONOMY_AUTHORITY_MODEL_PHASE20.md).

**Prerequisite:** SMP `shop_sell` path stable through Phases 18–19 (and Phase 20 ADR
signed off) before any debit live trial.

---

## 1. Current state

| Area | State |
|------|--------|
| **shop_sell** | Implemented: `EconomyShopGuiSellProducer` hooks EconomyShopGUI `PostTransactionEvent` (SELL); earn-side only in rollout docs |
| **shop_buy / gameplay_spend / spend** | **Not implemented** as producers; categories **disabled** in default `config.yml` |
| **In-game money** | Vault (via EconomyShopGUI / Essentials) still deducts purchases **in-game** |
| **DB schema** | Phase 6 migration (`202605270026`) accepts `shop_buy`, `gameplay_spend`, `spend` in ledger constraint |
| **Policy mapping** | `_economy_assert_policy`: debits require `can_spend`; `shop_buy` and `gameplay_spend` same gate as `spend` |
| **SMP policy (expected)** | `can_spend=false`, `max_debit_minor=0` until an approved debit trial — **do not set in Phase 21** |
| **Vote rewards** | Lobby1 `vote_reward` path separate; must stay untouched |

Debit ledger rows for shop purchases **do not exist** in production until a future
phased rollout explicitly enables them.

---

## 2. Why debit paths are higher risk

Earn-side (`shop_sell`) mistakes can over-credit players. Debit-side mistakes **remove**
money and are harder to unwind.

| Risk | Impact |
|------|--------|
| **Wrong debit amount** | Player loses money; support tickets; trust loss |
| **Double debit** | Same purchase recorded twice in ledger (idempotency failure) |
| **Purchase rollback / cancel** | GUI closed, transaction reversed in plugin but ledger row remains |
| **Event timing** | Pre-success event fires before Vault charge; ledger debits without Vault |
| **Insufficient funds** | Event fired but Vault rejected; ledger must not debit |
| **Refund / cancel behavior** | Partial refunds, admin undo — no automatic compensating flow yet |
| **Idempotency** | Must be **exact**; retried events, reloads, or duplicate hooks are critical |
| **Player support** | “Money disappeared” reports; need ledger row + Vault proof per incident |

**Rule:** Do not enable `can_spend` or live debit producers until sell-side SMP
monitoring (Phase 19) and this design are approved.

---

## 3. Target categories

| Category | Policy flag | Direction | Use |
|----------|-------------|-----------|-----|
| `shop_buy` | `can_spend` | Debit (`amount_minor < 0` in ledger) | EconomyShopGUI purchase |
| `gameplay_spend` | `can_spend` | Debit | Future generic gameplay costs (commands, minigames, etc.) |
| `spend` | `can_spend` | Debit | **Legacy alias** — same policy gate; prefer `gameplay_spend` or `shop_buy` for new producers |

API and RealCore should prefer explicit categories. Legacy `spend` remains for
compatibility with older clients or generic debits if ever needed.

---

## 4. Required event semantics (EconomyShopGUI buy)

Record a ledger debit **only if all** conditions hold:

| # | Condition |
|---|-----------|
| 1 | Transaction **completed successfully** (plugin result = success, not cancelled) |
| 2 | **Money was actually charged** to the player (Vault balance decreased for this purchase) |
| 3 | Currency is **Vault/money**, not item-only / barter-only trades |
| 4 | `amountMinor > 0` (debit magnitude stored as negative in ledger per existing conventions) |
| 5 | **Player UUID** valid and online or resolvable |
| 6 | **Idempotency key** stable for this economic fact (see §5) |
| 7 | Result is **not cancelled / refunded** at capture time |

**Do not record** on:

- Preview / price check events
- Failed purchases (insufficient funds, inventory full if purchase aborted without charge)
- Admin shop bypass unless explicitly in scope
- Sell events (handled by `shop_sell` producer)

**Implementation note (future):** Mirror sell producer pattern: reflection on
`PostTransactionEvent`, filter `BUY` (or equivalent) transaction type, same
`MONITOR` priority, validate `getTransactionResult()` success.

---

## 5. Idempotency strategy

### Key format

```text
gameplay:<serverId>:shop_buy:EconomyShopGUI:<playerUuid>:<eventId>
```

For `gameplay_spend` with another source:

```text
gameplay:<serverId>:gameplay_spend:<Source>:<playerUuid>:<eventId>
```

Legacy `spend` (if used):

```text
gameplay:<serverId>:spend:<Source>:<playerUuid>:<eventId>
```

### `eventId` composition (stable fields)

Include fields that uniquely identify **one economic debit**:

| Field | Example |
|-------|---------|
| Transaction type | `BUY`, `BUY_GUI` |
| Shop / item identifier | item path, shop screen id |
| Quantity | stack size |
| **Charged** amount (minor) | after discounts |
| Player UUID | |
| Plugin transaction id | if EconomyShopGUI exposes one |

Example (illustrative):

```text
BUY:blocks.diamond:1:5000:<playerUuid>:<pluginTxId>
```

### Warnings

| Anti-pattern | Why unsafe |
|--------------|------------|
| **Timestamp-only** `eventId` | Double-fire in same second → duplicate keys or missed dupes |
| Random UUID per hook invocation | Cannot dedupe legitimate retries |
| Omitting amount or item | Collides different purchases |

Windowed aggregation is **not** planned for shop_buy; one event → one ledger row.

---

## 6. Rollout phases for spend

| Phase | Name | Deliverable |
|-------|------|-------------|
| **A** | Docs / design | **This document**; authority ADR acknowledged |
| **B** | Disabled producer skeleton | `economyShopGuiBuy` config block `enabled: false`; hook registered but no-op or dry-run only |
| **C** | Dry-run only | SMP: `dryRun: true`, `shopBuy: true` category, `can_spend=false` in DB; verify logs, zero ledger rows |
| **D** | One tiny live buy | Single low-cost item; policy `can_spend=true` manual SQL; preflight live **READY** |
| **E** | Monitoring | 24h+ window: same metrics as Phase 19 for debits |
| **F** | Broader SMP enablement | Only after D+E pass; still `shop_buy` only |
| **G** | Factions | **Only after SMP stable**; separate policy row and monitoring |

`gameplay_spend` generic producer is **after** `shop_buy` is proven on SMP.

---

## 7. Policy requirements (future live SMP shop_buy trial)

> **DO NOT RUN IN PHASE 21.** Reference for Phase D/E only.

When both sell and buy are live on SMP, expected policy shape:

```sql
-- ═══ DO NOT RUN IN PHASE 21 ═══
-- Future manual enablement example (operator SQL only)
update public.economy_server_policies
set
  enabled = true,
  can_read = true,
  can_reward = false,
  can_earn = true,          -- true if shop_sell remains live; false if earn trial ended
  can_spend = true,
  max_credit_minor = 50000, -- if shop_sell remains live
  max_debit_minor = 50000,
  max_batch_count = 100,
  notes = 'SMP shop_buy live trial. Capped debit; earn optional.',
  updated_at = now()
where server_id = 'smp-1';
```

Earn-only debit trial variant: `can_earn=false`, `max_credit_minor=0`, `can_spend=true`,
`max_debit_minor=50000` — choose **one** trial mode at a time to simplify incident analysis.

Plugin config (future, not Phase 21):

```yaml
economy:
  gameplaySync:
    categories:
      shopSell: true   # only if earn trial still active
      shopBuy: true
      gameplaySpend: false
    producers:
      economyShopGuiBuy:
        enabled: true
        dryRun: false   # only in Phase D+
```

---

## 8. Verification SQL (future)

Run after dry-run (expect **zero** rows) and after live buy trial.

### shop_buy rows

```sql
select id, minecraft_uuid, amount_minor, balance_after_minor,
       idempotency_key, source_server_id, created_at
from public.economy_ledger
where category = 'shop_buy'
  and source_server_id = 'smp-1'
order by created_at desc
limit 20;
```

**Expected after one live buy:** one new row; `amount_minor < 0` (debit).

### Duplicate idempotency keys

```sql
select idempotency_key, count(*) as n, sum(amount_minor) as total_minor
from public.economy_ledger
where category = 'shop_buy'
  and source_server_id = 'smp-1'
  and created_at > now() - interval '7 days'
group by idempotency_key
having count(*) > 1;
```

**Expected:** zero rows.

### Balance decreases for test player

```sql
select minecraft_uuid, balance_minor, updated_at
from public.economy_balances
where currency_key = 'realfiction_main'
  and minecraft_uuid = '<test_player_uuid>';
```

Compare before/after buy; delta should match debit magnitude.

### No vote_reward from SMP

```sql
select source_server_id, count(*)
from public.economy_ledger
where category = 'vote_reward'
  and created_at > now() - interval '24 hours'
group by source_server_id;
```

**Expected:** `lobby-1` only.

### No other backends

```sql
select source_server_id, category, count(*)
from public.economy_ledger
where category in ('shop_buy', 'gameplay_spend', 'spend')
  and source_server_id <> 'smp-1'
  and created_at > now() - interval '7 days'
group by 1, 2;
```

**Expected:** zero rows.

### Spend cap enforcement (policy test)

Attempting a debit &gt; `max_debit_minor` via API should fail at policy layer before
ledger append (manual dry-run RPC in staging only — not Phase 21).

---

## 9. Rollback policy

| Step | Action |
|------|--------|
| 1 | Disable buy producer: `economyShopGuiBuy.enabled: false` |
| 2 | `gameplaySync.dryRun: true` on sync and producer |
| 3 | `shopBuy: false` in categories |
| 4 | Policy: `can_spend=false`, `max_debit_minor=0` |
| 5 | Restart SMP |
| 6 | **Preserve** all ledger rows |
| 7 | Erroneous debits: **compensating** `admin_adjustment` after review — never delete rows |

Sell-side rollback is independent; if only buy rolls back, sell policy may remain
`can_earn=true` per operator choice.

---

## 10. Stop conditions

Stop debit rollout immediately if:

| Condition |
|-----------|
| DB debit without matching Vault debit |
| Vault debit without DB record during **live** test |
| Wrong `amount_minor` vs shop price |
| Duplicate debit (same purchase, two ledger rows) |
| Cancelled purchase recorded |
| Refunded purchase not handled (ledger debited, money returned in-game) |
| API **4xx/5xx/429** storms on batch path |
| Queue drops / permanent rejects on debit batches |
| Player reports missing money correlated with sync window |
| Any `shop_buy` / `spend` row from non-`smp-1` server |
| `vote_reward` from SMP or Lobby regression |
| Phase 19-style duplicate credit **or** debit storms |

---

## 11. Non-goals

- DB-backed Vault provider (Option A) — future per Phase 20
- Automatic Vault ↔ DB reconciliation / delta mirror live sync (Option C rejected)
- Anarchy economy mutation
- Factions / Arcade debit rollout before SMP proof
- Direct balance table edits or ledger row deletes
- Refund automation (document manual compensating entries only)
- Enabling `gameplay_spend` producers without separate design review
- Changing Lobby1 vote reward delivery

---

## 12. Recommended spend rollout summary

1. **Finish** SMP `shop_sell` Phase 19 monitoring and sign Phase 20 authority ADR.
2. **Implement** disabled `economyShopGuiBuy` skeleton (Phase B) — separate code PR.
3. **Dry-run** on SMP with `can_spend=false` in DB (Phase C).
4. **One live buy** with manual policy SQL and `preflight live` (Phase D).
5. **Monitor** 24h+ (Phase E) before broader SMP or Factions (F/G).
6. Keep **`gameplay_spend`** generic path for later producers (admin commands, minigames).

Debit paths stay on **Option B**: Vault deducts in-game; RealCore records matching
append-only debits when hooks and policy allow.

---

## Related docs

| Doc | Role |
|-----|------|
| [ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md](./ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md) | Sell producer reference |
| [ECONOMY_TRANSACTION_CATEGORIES.md](./ECONOMY_TRANSACTION_CATEGORIES.md) | Category ↔ policy |
| [ECONOMY_AUTHORITY_MODEL_PHASE20.md](./ECONOMY_AUTHORITY_MODEL_PHASE20.md) | Vault vs DB authority |
| [ECONOMY_SMP_LIVE_MONITORING_PHASE19.md](./ECONOMY_SMP_LIVE_MONITORING_PHASE19.md) | Monitoring template for debits |
| [ECONOMY_SMP_SHOP_SELL_LIVE_EXECUTION.md](./ECONOMY_SMP_SHOP_SELL_LIVE_EXECUTION.md) | Earn-side live trial (prerequisite) |
| [ECONOMY_DATABASE_READINESS_PHASE17.md](./ECONOMY_DATABASE_READINESS_PHASE17.md) | DB verification |
