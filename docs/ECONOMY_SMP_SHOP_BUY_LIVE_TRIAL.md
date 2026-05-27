# SMP EconomyShopGUI Buy Live Ledger Trial (Phase 24)

Production-safe operator plan to enable **real** `shop_buy` ledger writes on **SMP
only** after [Phase 23 buy dry-run](ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md) passes
and staff explicitly approve a live debit trial.

**Scope of this document:** planning and verification steps only. This PR does
**not** run SQL, change Supabase policy, deploy jars, or flip SMP config.

**Authority:** Vault remains authoritative in-game short-term. The DB ledger
records approved events after policy + plugin live mode are enabled **manually**.

**Out of scope:** Factions, Arcade, Anarchy, Lobby1 vote reward changes, automatic
`can_spend` enablement, migrations, website/Cloudflare deploy.

---

## 1. Preconditions

Do **not** proceed unless **every** item is satisfied:

| # | Gate |
|---|------|
| 1 | [Phase 23](ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md) **shop_buy dry-run passed** (signed results template: `Approved for live buy trial: yes`) |
| 2 | **No `shop_buy` rows** appeared during Phase 23 dry-run (`shop_buy` count unchanged) |
| 3 | **`queued` remained 0** on `economyShopGuiBuy` during dry-run |
| 4 | **`dryRunCaptured` increased** on successful test buy(s) |
| 5 | **EconomyShopGUI Vault deduction** worked normally for test purchases |
| 6 | **No cancelled/failed buys** incremented `captured` during dry-run |
| 7 | **SMP performance** stable (TPS/MSPT normal; no gameplay-sync error spam) |
| 8 | **`shop_sell` monitoring stable** if `shop_sell` remains live on SMP (no writer failures, no unexplained ledger drift) |
| 9 | **Phase 22 jar** on SMP includes `EconomyShopGuiBuyProducer` |
| 10 | **Operator lead / economy owner** explicitly approves live debit trial (written sign-off) |
| 11 | **Lobby1** vote rewards unchanged; no SMP config changes to vote paths |

**Recommended:** `shop_sell` live trial already proven stable before first live
`shop_buy`. If `shop_sell` is paused, use the buy-only policy variant in §2.

---

## 2. Live policy target (manual SQL only)

Run in Supabase SQL Editor **only after** preflight and staff approval. **This
document does not execute SQL.**

### Default: shop_sell + shop_buy trial (both earn and spend)

Use when SMP may record both credits and debits within caps:

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
  notes = 'SMP live shop_sell/shop_buy ledger trial. Capped earn/spend; no rewards.',
  updated_at = now()
where server_id = 'smp-1';
```

Verify `where` clause matches exactly one row before `update`.

### Alternate: buy-only trial (`shop_sell` paused)

If **`shop_sell` is intentionally not live**, enable spend without earn:

```sql
update public.economy_server_policies
set
  enabled = true,
  can_read = true,
  can_reward = false,
  can_earn = false,
  can_spend = true,
  max_credit_minor = 0,
  max_debit_minor = 50000,
  max_batch_count = 100,
  notes = 'SMP live shop_buy-only ledger trial. No earn; capped debit.',
  updated_at = now()
where server_id = 'smp-1';
```

Document which variant was applied in the results template.

**Never** enable `can_reward` on `smp-1`. Vote rewards stay on Lobby1.

See also: [ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md](ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md).

---

## 3. SMP live buy config

Apply on **SMP only** (`server.id: smp-1`). Merge into `plugins/RealCore/config.yml`.
Restart SMP after policy SQL and config change (prefer full restart).

### Default: buy-only live trial

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
      shopSell: false
      shopBuy: true
    producers:
      economyShopGuiBuy:
        enabled: true
        category: shop_buy
        dryRun: false
        logEvents: true
        maxEventsPerFlush: 250
```

### Sell + buy together (requires explicit approval)

Only if staff approve **dual live** trial in writing:

- Set `shopSell: true` and `economyShopGuiSell.enabled: true` with `dryRun: false`
- Use §2 default policy (`can_earn` and `can_spend` both true)
- Monitor both producers separately in `/rf economy gameplay producers`
- Higher incident risk — prefer buy-only first

### Alignment checklist

| Setting | Live trial value |
|---------|------------------|
| `gameplaySync.dryRun` | `false` |
| `producers.economyShopGuiBuy.dryRun` | `false` |
| `categories.shopBuy` | `true` |
| Supabase `can_spend` | `true` (after manual SQL) |
| Supabase `max_debit_minor` | `> 0` (e.g. `50000`) |

---

## 4. Preflight

On SMP, as staff with `realcore.admin`:

```
/rf economy gameplay preflight live
```

### Expected

| Result | Meaning |
|--------|---------|
| Summary **READY** | Safe to proceed to single live buy |
| No **FAIL** checks | Any FAIL → stop; fix config/policy/jar |
| **WARN** `dbPolicyWritePermissionNotProven` | Acceptable **only if** §2 SQL was run and verified manually |
| `shopBuy` / buy producer | Enabled, not dry-run |
| `dryRun` | `false` at sync and producer level |

Also record baseline:

```
/rf economy gameplay producers
```

Note `economyShopGuiBuy` `captured`, `queued`, `dryRunCaptured` (should be 0 dry-run after live flip).

---

## 5. Execute one tiny buy

1. Record **Vault balance** and **DB balance** (website/API or staff tool) for test player.
2. Purchase a **very low-cost** item via EconomyShopGUI (single unit).
3. Confirm GUI success (item received, money deducted in-game).
4. Record timestamps and `/rf economy gameplay producers` after flush (~30–60s).

### Record

| Field | Value |
|-------|--------|
| Player UUID / name | |
| Item purchased | |
| Expected `amountMinor` (from log or GUI price × 100) | |
| Vault balance before / after | |
| DB balance before / after | |
| UTC timestamp | |

---

## 6. Expected behavior

| Layer | Expected |
|-------|----------|
| EconomyShopGUI / Vault | Balance **decreases** by purchase price (normal gameplay) |
| RealCore capture | `shop_buy` event captured (not dry-run) |
| Writer | Brief queue activity; batch sent to economy API |
| Ledger | **One** new `shop_buy` row for this purchase on `smp-1` |
| `economy_balances` | **Decreases** by expected debit magnitude |
| Idempotency | **No duplicate** row for same idempotency key |
| Vote rewards | **No** `vote_reward` rows from SMP |
| Other categories | **No** new `gameplay_spend` / `spend` unless explicitly testing |
| Other servers | **No** Factions / Arcade / Anarchy gameplay rows from this test |

Log may show `[GameplaySync:QUEUE]` instead of `[GameplaySync:DRYRUN]` when live.

Idempotency key format:

```text
gameplay:smp-1:shop_buy:economyshopgui:<playerUuid>:<eventId>
```

---

## 7. Verification SQL (manual, read-only)

Run in Supabase **after** the test buy. Do not run from CI or this repo automatically.

### Latest `shop_buy` rows for SMP

```sql
select
  id,
  minecraft_uuid,
  category,
  amount_minor,
  source_server_id,
  idempotency_key,
  external_ref_type,
  external_ref_id,
  created_at
from public.economy_ledger
where category = 'shop_buy'
  and source_server_id = 'smp-1'
order by created_at desc
limit 10;
```

### Duplicate check by idempotency key

```sql
select idempotency_key, count(*) as row_count
from public.economy_ledger
where category = 'shop_buy'
  and source_server_id = 'smp-1'
  and created_at > now() - interval '1 hour'
group by idempotency_key
having count(*) > 1;
```

**Expected:** no rows (no duplicates).

### Balance before/after (test player)

```sql
select minecraft_uuid, balance_minor, updated_at
from public.economy_balances
where minecraft_uuid = '<TEST_PLAYER_UUID>';
```

Compare to recorded Vault/DB readings; investigate unexplained divergence.

### No `vote_reward` from SMP

```sql
select count(*) as smp_vote_rewards
from public.economy_ledger
where category = 'vote_reward'
  and source_server_id = 'smp-1'
  and created_at > now() - interval '1 hour';
```

**Expected:** `0` (vote rewards remain Lobby1).

### No non-SMP gameplay rows in test window

```sql
select source_server_id, category, count(*) as n
from public.economy_ledger
where category in ('shop_buy', 'shop_sell', 'gameplay_earn', 'gameplay_spend', 'spend')
  and created_at > now() - interval '1 hour'
group by source_server_id, category
order by source_server_id, category;
```

**Expected:** only `smp-1` rows from this trial (and only intended categories).

### Unexpected categories

```sql
select category, count(*) as n
from public.economy_ledger
where source_server_id = 'smp-1'
  and created_at > now() - interval '1 hour'
group by category
order by category;
```

### Policy state

```sql
select
  server_id,
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
where server_id = 'smp-1';
```

### Largest recent debits (sanity)

```sql
select
  id,
  minecraft_uuid,
  amount_minor,
  category,
  idempotency_key,
  created_at
from public.economy_ledger
where source_server_id = 'smp-1'
  and amount_minor < 0
order by created_at desc
limit 20;
```

Confirm test debit magnitude matches expected `amountMinor` (negative in ledger).

---

## 8. Critical warning

**Debit bugs are more dangerous than earn bugs.**

| Failure mode | Risk |
|--------------|------|
| DB debit recorded, Vault **did not** charge | Player loses DB/global balance without paying in-game |
| Vault charged, DB **did not** record | Hidden drift; support and reconciliation pain |
| Duplicate debit rows | Double removal from global balance |
| Cancelled/failed buy recorded | Wrong punishment |

If either side disagrees during the live test: **stop immediately**.

- **Do not** auto-compensate with `admin_adjustment` or Vault commands.
- **Do not** delete ledger rows.
- Preserve logs, config snapshot, SQL query outputs, and `/rf economy gameplay` screens.
- Escalate to economy owner for manual review.

---

## 9. Rollback

Execute in order (SMP only):

### Plugin config

1. `economy.gameplaySync.dryRun: true`
2. `economy.gameplaySync.producers.economyShopGuiBuy.dryRun: true`
3. `economy.gameplaySync.producers.economyShopGuiBuy.enabled: false`
4. `economy.gameplaySync.categories.shopBuy: false`
5. Restart SMP or reload RealCore (prefer restart)

### Supabase policy (manual SQL)

```sql
update public.economy_server_policies
set
  can_spend = false,
  max_debit_minor = 0,
  notes = 'Rollback: SMP shop_buy live trial stopped. Read-only debit until re-approved.',
  updated_at = now()
where server_id = 'smp-1';
```

If reverting full trial, restore Phase 5 read-only SMP policy per
[ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md](ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md).

### Ledger

- **Do not delete** ledger rows written during trial.
- **Compensating `admin_adjustment`** only after incident review and explicit approval.

---

## 10. Stop conditions

Stop immediately and roll back (§9) if **any** occur:

| Condition |
|-----------|
| Duplicate debit for one purchase |
| Wrong `amount_minor` vs expected price |
| Cancelled buy recorded as `shop_buy` |
| Failed buy recorded |
| Refund/cancel behavior unclear or compensating row missing |
| DB debit without matching Vault deduction |
| Vault deduction without DB row during live test window |
| API **400 / 403 / 429 / 500** on gameplay batches |
| Gameplay queue overflow or sustained writer failures |
| TPS/MSPT degradation correlated with trial |
| Ledger rows for **non-SMP** servers |
| **Lobby1 vote rewards** behavior changes |
| Unexpected `gameplay_spend` / `spend` rows |
| `duplicateRejected` storm or error log spam |

---

## 11. Results template

```markdown
## SMP shop_buy live trial result

- **Operator:**
- **Timestamp (UTC):**
- **Jar / git commit:**
- **Policy variant:** (sell+buy SQL / buy-only SQL)
- **Config variant:** (buy-only / sell+buy)
- **Player UUID / name:**
- **Item purchased:**
- **amountMinor (expected / ledger):**
- **Vault balance before / after:**
- **DB balance before / after:**
- **Ledger row id:**
- **Idempotency key:**
- **Preflight live:** (READY / NOT READY)
- **Writer counters:** queued / ok / fail (from `/rf economy gameplay`)
- **Phase 23 dry-run reference:** (link or date)
- **Rollback needed:** yes / no
- **Approved for ongoing monitoring:** yes / no → if yes with sell trial done, use [ECONOMY_SMP_EARN_SPEND_MONITORING_PHASE25.md](ECONOMY_SMP_EARN_SPEND_MONITORING_PHASE25.md)
```

---

## Success criteria

- [ ] Phase 23 dry-run signed off
- [ ] Manual policy SQL applied and verified (§7 policy query)
- [ ] Preflight **live** READY (no FAILs)
- [ ] One tiny buy: Vault deducts normally
- [ ] Exactly one `shop_buy` ledger row; idempotency unique
- [ ] `economy_balances` matches expected debit
- [ ] No SMP `vote_reward` rows
- [ ] No non-SMP / unexpected category rows
- [ ] Rollback SQL documented if stopping

## Related docs

- [ECONOMY_SMP_EARN_SPEND_MONITORING_PHASE25.md](ECONOMY_SMP_EARN_SPEND_MONITORING_PHASE25.md) — combined sell+buy monitoring (after both single trials)
- [ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md](ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md) — Phase 23 prerequisite
- [ECONOMY_SMP_SHOP_SELL_LIVE_TRIAL.md](ECONOMY_SMP_SHOP_SELL_LIVE_TRIAL.md) — sell single-event trial prerequisite
- [ECONOMY_SHOP_BUY_SPEND_DESIGN_PHASE21.md](ECONOMY_SHOP_BUY_SPEND_DESIGN_PHASE21.md) — debit design
- [ECONOMY_GAMEPLAY_PREFLIGHT.md](ECONOMY_GAMEPLAY_PREFLIGHT.md) — preflight modes
- [ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md](ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md) — policy rollback
- [GAMEPLAY_ECONOMY_SYNC_DESIGN.md](GAMEPLAY_ECONOMY_SYNC_DESIGN.md) — phase index
