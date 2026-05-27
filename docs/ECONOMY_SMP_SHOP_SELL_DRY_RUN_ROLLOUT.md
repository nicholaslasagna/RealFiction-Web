# SMP EconomyShopGUI Sell Dry-Run Rollout (Phase 10)

Operator plan to install the Phase 8/9+ RealCore jar on **SMP only** and verify
`economyShopGuiSell` captures sell events in **dry-run mode** with **no DB ledger
writes**.

This is **SMP dry-run only**. It does not enable `can_earn`, `can_spend`, or any
Supabase gameplay write policy.

**Phase 16 (current RC):** use the validation checklist and results template in
[`ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md`](./ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md)
with jar built from `main` at `9787587ed46bf6a2e516aa9e84b9a21e94094620` (Phase 13/14
observability + preflight on `main`).

**Before SMP deploy:** confirm the full gameplay economy stack is on `main` and
follow the RC checklist in
[`REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md`](REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md)
(merge order, `mvn package`, SMP-only jar, no Factions/Arcade/Anarchy).

## Preconditions

Before changing SMP config or installing a jar:

1. **Phase 6** category migration applied in Supabase (`202605270026`) if not already live.
2. **Phase 5** SMP read-only policy applied (`smp-1`: `can_read=true`, all write flags false, caps `0`).
3. **Phase 7** write-trial SQL **not** run — do not set `can_earn=true` or `can_spend=true`.
4. **Lobby1** vote reward ledger writes remain live and unchanged on Lobby1 jar/config.
5. **EconomyShopGUI** (or EconomyShopGUI-Premium) installed and working on SMP.
6. Staff have reviewed Phase 9 producer behavior (`docs/ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md`).
7. Snapshot taken:
   - SMP `plugins/RealCore/config.yml` (or economy section backup)
   - Current RealCore jar path/version
   - Optional: Supabase `economy_ledger` row counts (see SQL below)

## Scope of this rollout

| In scope | Out of scope |
|----------|----------------|
| SMP jar install/replace | Lobby1 jar change (unless unrelated maintenance) |
| SMP config dry-run enable | Factions / Arcade / Anarchy |
| EconomyShopGUI sell test | `shop_buy`, `gameplay_spend` |
| Log and `/rf economy` verification | `dryRun=false` or live ledger writes |
| Confirm no `shop_sell` ledger rows | DB policy `can_earn` enablement |

## SMP dry-run config (exact intent)

Apply on **SMP backend only** (`server.id: smp-1`). Merge into existing
`plugins/RealCore/config.yml`; do not copy Lobby1 economy settings.

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
      shopSell: true
      gameplayEarn: false
      gameplaySpend: false
      shopBuy: false
    producers:
      economyShopGuiSell:
        enabled: true
        category: shop_sell
        dryRun: true
        logEvents: true
        maxEventsPerFlush: 250
```

### Why this does not require `can_earn=true`

Dry-run stops before `BufferedEconomyTransactionWriter` enqueues or calls the
economy API. Supabase `economy_server_policies` for `smp-1` can remain read-only
(`can_earn=false`, `can_spend=false`). No `apply_economy_batch` RPC should run
for gameplay sync during this test.

Keep global buffer dry-run aligned:

```yaml
economy:
  gameplaySync:
    dryRun: true   # must stay true for this rollout
```

Keep producer dry-run aligned:

```yaml
    producers:
      economyShopGuiSell:
        dryRun: true   # must stay true for this rollout
```

### What not to change on SMP

- Do **not** set `economy.gameplaySync.dryRun: false`
- Do **not** set `economy.gameplaySync.producers.economyShopGuiSell.dryRun: false`
- Do **not** enable `gameplayEarn`, `gameplaySpend`, or `shopBuy` categories
- Do **not** change vote reward settings (`voteRewardsLedgerWritesEnabled`, fallback, etc.)
- Do **not** run Phase 7 SMP write-trial SQL

## Jar install (operator steps)

1. Build or obtain jar from current `main` RC (Phase 13/14+), e.g.
   `realcore/target/RealCore-0.1.0-SNAPSHOT.jar` at commit `9787587…` (see Phase 16
   validation doc for checksum recording).
2. **Maintenance window** on SMP only: stop server or use your standard plugin reload procedure.
3. Replace `plugins/RealCore/RealCore-*.jar` with the new jar (keep a backup of the previous jar).
4. Apply the SMP dry-run config section above.
5. Start SMP (or `plugman reload RealCore` / full restart per your ops standard — prefer full restart for first producer test).
6. Confirm console shows EconomyShopGUI present and no RealCore startup errors.

No website deploy, no Supabase migration, and no Cloudflare deploy are required for this dry-run test.

## Commands to verify (in-game / console)

Run as a staff member with `realcore.admin` on SMP.

### 1. Baseline economy status

```
/rf economy
```

Note global economy state, vote reward ledger lines (should reflect Lobby policy if you are on SMP — vote writes happen on Lobby1, not SMP), and gameplay producer summary.

### 2. Gameplay sync detail

```
/rf economy gameplay
```

Expected (values approximate):

- `Gameplay sync: enabled`, `dry-run`
- `allowlist smp-1`
- `shop_sell=on` (other categories off)
- `Gameplay buffer: 0 accepted`, dry-run/rejected as applicable
- Producer section shows `economyShopGuiSell` enabled, producer dry-run on

### 3. Dry-run preflight (Phase 14+)

```
/rf economy gameplay preflight dryrun
```

Expected: summary **READY**; `dryRun=true`; `shopSell` on; producer enabled; `queued=0`;
no writer failures. If **NOT READY**, stop and roll back before any sell test.

### 4. Producer metrics (before sell)

```
/rf economy gameplay producers
```

Record baseline counters:

- `captured`, `dryRunCaptured`, `queued`
- `duplicateRejected`, `invalidRejected`, `overCapRejected`
- `Hook: listening for PostTransactionEvent (SELL)` when EconomyShopGUI is installed

### 5. Perform one small EconomyShopGUI sell

- Use a staff alt or test account.
- Sell a **small** stack of a common item (low value) through EconomyShopGUI GUI or sell command.
- Confirm the player receives Vault/Essentials money normally (local economy unchanged).

### 6. Re-check producer metrics (after sell)

```
/rf economy gameplay producers
```

### 7. Check server logs

Search console/log file for:

```text
[GameplaySync:DRYRUN]
```

### 8. Vote rewards unchanged (Lobby1)

On **Lobby1** (not SMP), if verifying vote path separately:

- Confirm vote rewards still deliver (ledger + fallback behavior per Lobby config).
- This SMP test must not change Lobby1 `config.yml`.

On SMP, vote reward **writes** should not occur; SMP is not a vote reward backend.

## Expected dry-run results

### Log line format

```text
[GameplaySync:DRYRUN] server=smp-1 category=shop_sell player=Steve(550e8400-e29b-41d4-a716-446655440000) amountMinor=125 source=EconomyShopGUI eventId=SELL_GUI_SCREEN:blocks.cobblestone:64:125:550e8400-e29b-41d4-a716-446655440000
```

Fields may vary; `category=shop_sell`, `source=EconomyShopGUI`, and `amountMinor` must be present.

### `/rf economy gameplay producers` after one sell

| Metric | Expected |
|--------|----------|
| `captured` | Increments by ≥ 1 |
| `dryRunCaptured` | Increments by ≥ 1 |
| `queued` | **Stays 0** |
| `Hook` | `listening for PostTransactionEvent (SELL)` |
| `dedup cache` | May show 1+ keys after capture |

### `/rf economy gameplay` buffer line

- `Gameplay buffer: 0 accepted` (or accepted unchanged)
- Writer queued count **0** (no live enqueue)

### System behavior

- **No** new `economy_ledger` rows with `category = shop_sell` (or gameplay categories).
- **No** HTTP calls to `/api/plugin/economy/transactions` from this producer path during dry-run.
- Player **Vault balance still changes** from EconomyShopGUI (local sell proceeds as today).
- **Vote_reward** ledger activity on Lobby1 unaffected.

## Optional Supabase verification SQL

Run in Supabase SQL Editor **before** and **after** the sell test. Read-only checks only.

### Ledger counts by category (SMP should not add shop_sell)

```sql
select category, count(*) as row_count
from public.economy_ledger
group by category
order by category;
```

Before/after: `shop_sell` count must be **unchanged**. If `shop_sell` rows appear during dry-run, **stop and roll back immediately**.

### Recent shop_sell rows (should be empty or unchanged)

```sql
select id, category, amount_minor, source_server_id, created_at
from public.economy_ledger
where category = 'shop_sell'
order by created_at desc
limit 20;
```

### Vote rewards unaffected

```sql
select count(*) as vote_reward_rows
from public.economy_ledger
where category = 'vote_reward'
  and created_at > now() - interval '1 hour';
```

Compare to normal Lobby1 vote volume; SMP dry-run must not add `vote_reward` rows from SMP.

### SMP policy still read-only

```sql
select
  server_id,
  enabled,
  can_read,
  can_reward,
  can_earn,
  can_spend,
  max_credit_minor,
  max_debit_minor
from public.economy_server_policies
where server_id = 'smp-1';
```

Expected: `can_earn=false`, `can_spend=false`, caps `0` (unless a separate approved change was made).

## Stop conditions

Stop immediately, roll back config, and escalate if **any** of the following occur:

| Condition | Action |
|-----------|--------|
| New `shop_sell` (or gameplay) rows in `economy_ledger` | Roll back; investigate jar/config |
| `queued` metric increments during dry-run | Roll back; do not continue |
| Evidence of `/api/plugin/economy/transactions` calls from gameplay producer | Roll back |
| Error spam in console (reflection hook, NPE, repeated warnings) | Roll back |
| `duplicateRejected` grows rapidly without sells | Roll back; possible event loop |
| Vault balances stop updating on normal EconomyShopGUI sells | Roll back; do not blame DB sync |
| TPS/MSPT sustained degradation correlated with test | Roll back |
| Any change to Lobby1 vote reward behavior | Roll back SMP config; verify Lobby1 |
| Accidental `dryRun: false` or policy write enablement | Roll back |

## Rollback steps

1. Set `economy.gameplaySync.enabled: false` on SMP.
2. Set `economy.gameplaySync.producers.economyShopGuiSell.enabled: false`.
3. Optionally restore `economy.enabled: false` and `modules.economy: false` if SMP did not use economy client before.
4. `plugman reload RealCore` or **restart SMP** (prefer restart).
5. If issues persist, restore previous RealCore jar from backup.
6. Re-run Supabase verification SQL to confirm no new gameplay ledger rows after rollback window.

No compensating ledger entries are required for dry-run-only testing unless accidental live writes occurred (then follow staff incident procedure).

## Explicit warnings

- **Do not** enable `can_earn` / `can_spend` in Supabase for this test.
- **Do not** set `dryRun: false` on gameplay sync or the producer.
- **Do not** enable `gameplaySpend`, `shopBuy`, or `gameplayEarn` unless explicitly planning a different phase.
- **Do not** test on Anarchy (hard-refused in RealCore).
- **Do not** deploy this config to Factions or Arcade yet.
- **Do not** disable vote reward fallback on Lobby1 as part of this SMP test.
- **Do not** run `admin_import_economy_balances` or manual balance overwrites during the test.
- **Do not** confuse EconomyShopGUI Vault payouts (normal) with DB ledger writes (must not happen in dry-run).

## Success criteria

- [ ] Results recorded in [ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md](./ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md)
- [ ] SMP running Phase 13/14 RC jar (`9787587…`) without startup errors
- [ ] `/rf economy gameplay preflight dryrun` → READY
- [ ] EconomyShopGUI sell produces `[GameplaySync:DRYRUN]` log line
- [ ] `captured` and `dryRunCaptured` increment; `queued` stays 0
- [ ] No new `shop_sell` ledger rows in Supabase
- [ ] `smp-1` policy remains read-only (`can_earn=false`, `can_spend=false`)
- [ ] Lobby1 vote rewards unchanged
- [ ] Local Vault sell behavior normal for players

## Related docs

- [ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md](./ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md) — Phase 16 checklist + results template
- [ECONOMY_GAMEPLAY_PREFLIGHT.md](./ECONOMY_GAMEPLAY_PREFLIGHT.md) — preflight commands
- [REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md](REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md) — merge order, RC build, SMP deploy/rollback
- [ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md](ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md) — producer design
- [ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md](ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md) — future live writes (not this rollout)
- [GAMEPLAY_ECONOMY_SYNC_DESIGN.md](GAMEPLAY_ECONOMY_SYNC_DESIGN.md) — full phase plan
