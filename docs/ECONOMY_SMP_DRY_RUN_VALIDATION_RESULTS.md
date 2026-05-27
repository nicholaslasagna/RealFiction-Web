# SMP dry-run deployment validation (Phase 16)

Operator checklist and **results record** for deploying the Phase 13/14 RC RealCore jar
to **SMP only** in gameplay **dry-run** mode, then validating EconomyShopGUI sell
capture with **no Supabase ledger writes**.

This phase is **ops/checklist only**. It does not authorize live writes, policy SQL,
migrations, or deploys to Lobby1 / Factions / Arcade / Anarchy.

**Procedure reference:** [ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md](./ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md)  
**Preflight reference:** [ECONOMY_GAMEPLAY_PREFLIGHT.md](./ECONOMY_GAMEPLAY_PREFLIGHT.md)

---

## RC artifact (build from `main` before deploy)

| Field | Value |
|-------|--------|
| **Git commit (`main`)** | `9787587ed46bf6a2e516aa9e84b9a21e94094620` |
| **Jar (local build)** | `realcore/target/RealCore-0.1.0-SNAPSHOT.jar` |
| **Merge stack** | #56 (observability) + #57 (preflight) on `main` |

Verify local jar matches `main` before copying to SMP:

```bash
git fetch origin && git checkout main && git pull
git rev-parse HEAD   # expect 9787587…
mvn -B -f realcore/pom.xml clean package -q
shasum -a 256 realcore/target/RealCore-0.1.0-SNAPSHOT.jar
```

Record the checksum in the results section below.

---

## Operator approval gate

| Gate | Operator | Date (UTC) | Approved |
|------|----------|------------|----------|
| SMP maintenance / jar replace | | | ☐ |
| SMP config change (dry-run only) | | | ☐ |
| One test sell (low value) | | | ☐ |
| Supabase read-only SQL (before/after) | | | ☐ |

Do **not** proceed past a gate until the prior step passes. If any stop condition
fires, skip to [Rollback](#8-rollback) and set **rollback needed = yes**.

---

## 1. Backup SMP current RealCore jar

**SMP only.** Do not touch Lobby1 plugin directories.

- [ ] Note current jar path, e.g. `plugins/RealCore/RealCore-*.jar`
- [ ] Record old jar filename: `________________________`
- [ ] Record checksum if possible:

```bash
shasum -a 256 /path/to/smp/plugins/RealCore/RealCore-*.jar
```

- [ ] Copy to rollback location, e.g. `plugins/RealCore/rollback/RealCore-pre-phase16-YYYYMMDD.jar`
- [ ] Optional: backup `plugins/RealCore/config.yml` (or economy section only)

| Rollback jar path | Checksum (sha256) |
|-------------------|-------------------|
| | |

---

## 2. Install RC jar on SMP only

- [ ] Stop SMP (or use approved maintenance procedure)
- [ ] Install jar built from `9787587…` (see [RC artifact](#rc-artifact-build-from-main-before-deploy))
- [ ] **Do not** install on Lobby1, Factions, Arcade, or Anarchy
- [ ] Start SMP / restart (prefer full restart for first producer test)
- [ ] Console: RealCore enables without stack traces
- [ ] Console: EconomyShopGUI (or Premium) detected if installed
- [ ] No accidental edits to Lobby1 `config.yml` or jar

| SMP start clean | Notes |
|-----------------|-------|
| ☐ yes ☐ no | |

---

## 3. SMP config (dry-run only)

Merge into **SMP** `plugins/RealCore/config.yml` only. Confirm `server.id: smp-1`.

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
      shopSell: true
      shopBuy: false
    producers:
      economyShopGuiSell:
        enabled: true
        category: shop_sell
        dryRun: true
        logEvents: true
```

**Must remain true (global gameplay sync):**

```yaml
economy:
  gameplaySync:
    dryRun: true
```

**Must not change:**

- `dryRun: false` (gameplay sync or producer)
- `can_earn` / `can_spend` in Supabase (no Phase 7 write-trial SQL)
- Lobby1 vote reward settings
- Factions / Arcade / Anarchy configs

| Config applied | Reload/restart |
|----------------|----------------|
| ☐ | ☐ restart ☐ reload |

---

## 4. Run commands (staff, `realcore.admin`)

Run in order on SMP console or in-game:

```text
/rf economy
/rf economy gameplay
/rf economy gameplay producers
/rf economy gameplay preflight dryrun
```

### Expected (dry-run preflight)

| Check | Expected |
|-------|----------|
| Preflight summary | **READY** (no FAIL lines) |
| `gameplaySync` | `enabled=true` |
| `dryRun` | `true` |
| `shopSell` | on / true |
| `producerDisabled` | PASS (producer enabled) |
| Gameplay queue | `0` or low; not at capacity |
| Writer | no recent failures; HTTP none or benign in dry-run |
| `noWriterEnqueue` | PASS (`accepted=0`) |

Paste or summarize command output in [Results template](#results-template) below.

| Command | Pass ☐ | Notes |
|---------|--------|-------|
| `/rf economy` | | |
| `/rf economy gameplay` | | |
| `/rf economy gameplay producers` | | |
| `/rf economy gameplay preflight dryrun` | | |

**If preflight is NOT READY:** stop; do not sell-test; [rollback](#8-rollback).

---

## 5. Test one tiny EconomyShopGUI sell

- [ ] Staff/test alt on SMP only
- [ ] Sell one **low-value** item via EconomyShopGUI (GUI or command)
- [ ] Player receives normal Vault payout (EconomyShopGUI unchanged)
- [ ] Re-run `/rf economy gameplay producers`

### Expected log (console)

```text
[GameplaySync:DRYRUN] server=smp-1 category=shop_sell ...
```

(Category, player UUID, `amountMinor`, `source=EconomyShopGUI`, `eventId` should be present.)

### Expected counters (after one sell)

| Metric | Expected |
|--------|----------|
| `captured` | +1 (or ≥1 total) |
| `dryRunCaptured` | +1 (or ≥1 total) |
| `queued` | **0** (unchanged) |
| Writer sent / gameplay queued (isolated) | **unchanged** for dry-run path |
| API `/api/plugin/economy/transactions` | **not** called from this producer dry-run |

| Sell test pass | Log line captured |
|----------------|-------------------|
| ☐ | ☐ paste below |

**Dry-run log line (paste):**

```text

```

---

## 6. Supabase verification (read-only SQL)

Run in Supabase SQL Editor **before** and **after** the sell test. **No migrations.**
**Do not** run Phase 7 write-trial SQL.

### Before test

```sql
select count(*)
from public.economy_ledger
where category = 'shop_sell';
```

| `shop_sell` count (before) | Timestamp (UTC) |
|----------------------------|-----------------|
| | |

### After test

```sql
select count(*)
from public.economy_ledger
where category = 'shop_sell';
```

| `shop_sell` count (after) | Delta |
|---------------------------|-------|
| | |

**Expected:** count **does not increase** during dry-run.

### Recent gameplay-category rows

```sql
select *
from public.economy_ledger
where category in ('shop_sell', 'shop_buy', 'gameplay_earn', 'gameplay_spend', 'spend')
order by created_at desc
limit 20;
```

**Expected:** no new rows attributable to this SMP dry-run test.

| New rows from test | ☐ none ☐ found (STOP) |
|--------------------|------------------------|

### SMP policy unchanged (read-only)

```sql
select server_id, enabled, can_read, can_reward, can_earn, can_spend,
       max_credit_minor, max_debit_minor
from public.economy_server_policies
where server_id = 'smp-1';
```

**Expected:** `can_earn=false`, `can_spend=false`, write caps `0` (unless a separate approved change exists).

| Policy read-only confirmed | ☐ |
|----------------------------|---|

---

## 7. Stop conditions

**Immediately rollback** if any occur:

| Condition | Observed ☐ |
|-----------|------------|
| Preflight **NOT READY** | |
| Any new `shop_sell` (or gameplay) `economy_ledger` row | |
| `queued` increments during dry-run | |
| Writer sends economy transaction during dry-run | |
| Evidence of producer calling `/api/plugin/economy/transactions` | |
| Console error spam (hook/NPE/repeated warnings) | |
| Sustained TPS/MSPT degradation during test | |
| EconomyShopGUI stops paying Vault normally | |
| Lobby1 / Factions / Arcade / Anarchy affected | |
| Accidental `dryRun: false` or `can_earn`/`can_spend` enabled | |

---

## 8. Rollback

If stop conditions triggered or test incomplete:

1. [ ] `economy.gameplaySync.enabled: false`
2. [ ] `economy.gameplaySync.producers.economyShopGuiSell.enabled: false`
3. [ ] Restart SMP (prefer over reload)
4. [ ] Restore previous RealCore jar if needed (from [step 1](#1-backup-smp-current-realcore-jar))
5. [ ] **Do not** change Lobby1 jar/config
6. [ ] Re-run Supabase count SQL — no new gameplay rows after rollback window
7. [ ] No DB rollback needed if dry-run was correct and no live writes occurred

| Rollback performed | Rollback jar restored |
|--------------------|------------------------|
| ☐ | ☐ yes ☐ no |

---

## Results template

Copy this block into a staff ticket or append dated entries below.

```markdown
### SMP dry-run validation — YYYY-MM-DD

| Field | Value |
|-------|--------|
| **SMP server ID** | smp-1 |
| **Jar commit** | 9787587ed46bf6a2e516aa9e84b9a21e94094620 |
| **Jar sha256** | |
| **Test time (UTC)** | |
| **Operator** | |
| **Preflight result** | READY / NOT READY |
| **Command outputs summary** | (gameplay enabled, dryRun=true, shopSell on, queued=0, no failures) |
| **Dry-run log line** | (paste [GameplaySync:DRYRUN] line) |
| **shop_sell count before** | |
| **shop_sell count after** | |
| **Ledger delta** | 0 expected |
| **Rollback needed** | yes / no |
| **Operator approval for Phase 17** | yes / no / deferred |

**Notes:**

```

---

## Validation log (dated entries)

<!-- Operators append completed runs below -->

---

## Success criteria (Phase 16 complete)

- [ ] RC jar from `9787587…` on SMP only; Lobby1 untouched
- [ ] Dry-run config only (`dryRun=true`, no `can_earn`/`can_spend`)
- [ ] `/rf economy gameplay preflight dryrun` → **READY**
- [ ] One sell → `[GameplaySync:DRYRUN]`; `captured`/`dryRunCaptured` +1; `queued=0`
- [ ] `shop_sell` ledger count unchanged
- [ ] Vault payout normal; no stop conditions
- [ ] Results template filled; Phase 17 approval recorded explicitly

## Related docs

- [ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md](./ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md) — detailed rollout
- [ECONOMY_GAMEPLAY_OBSERVABILITY.md](./ECONOMY_GAMEPLAY_OBSERVABILITY.md) — metrics interpretation
- [REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md](./REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md) — RC merge history
