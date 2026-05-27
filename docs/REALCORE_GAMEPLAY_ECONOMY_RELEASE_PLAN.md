# RealCore Gameplay Economy Release Plan (Phase 11)

Consolidated **merge order**, **release-candidate (RC) build**, and **SMP dry-run
deployment** checklist so staff do not ship a partial or inconsistent RealCore
economy rollout.

This document is **planning only**. It does not merge PRs, run migrations, or
deploy jars.

> **Verify before you act:** PR numbers and merge status change over time. Run
> `gh pr list --state merged --search "economy OR vault OR gameplay"` and
> `git log origin/main --oneline -30` before following steps below.

## Merge status (check `main` before RC build)

Stacked PRs may show **MERGED** on GitHub while only their **base branch** moved
(for example #52 → `codex/gameplay-economy-buffer-phase8`, not `main`). **RC jar
builds must use `origin/main` after the full stack is merged to `main`.**

Typical split (re-verify):

| On `main` already | Still on stacked branch until merged to `main` |
|-------------------|------------------------------------------------|
| #44, #48–#51, #49, #50 | #45 → #46 → #47 → #52 → #53 |

If #45–#47 or #52–#53 are not on `main`, complete section **B** below before
section **C** (RC build / SMP deploy).

## PR dependency graph

### Independent (merge to `main` anytime in this order)

| PR | Branch (typical) | Type | Depends on |
|----|------------------|------|------------|
| **#49** | `codex/economy-transaction-categories-phase6` | Migration + API categories | `main` (after prior economy foundation on main) |
| **#50** | `codex/smp-gameplay-write-policy-phase7` | Docs only (staged SMP write SQL) | **#49 recommended** (references category names); can merge in parallel if docs only |

**#49 before any real write trial:** **Yes.** Schema and API must accept
`shop_sell`, `gameplay_spend`, etc. before enabling live `can_earn` / producer
live enqueue. Dry-run producer does not require `can_earn=true` but still
benefits from #49 being applied in Supabase.

**#50 anytime after #49:** **Yes.** #50 is operator SQL/docs only; no jar
requirement. Merge after #49 avoids doc drift on category names.

### RealCore stack (sequential — each PR targets previous branch or stacks via merge)

```text
main
 └── #44  vault delta shadow observer
      └── #45  shadow analytics
           └── #46  DB balance read path
                └── #47  manual DB → Vault alignment
                     └── #51  gameplay transaction buffer (Phase 8)
                          └── #52  EconomyShopGUI sell producer (Phase 9)
                               └── #53  SMP shop_sell dry-run ops docs (Phase 10)
```

| PR | Phase | Summary |
|----|-------|---------|
| **#44** | 1 | `VaultDeltaShadowService` — log-only |
| **#45** | 2 | Shadow analytics / observability |
| **#46** | 3 | Plugin DB balance read path |
| **#47** | 4 | Admin manual DB→Vault alignment |
| **#51** | 8 | `GameplayEconomyTransactionBuffer` |
| **#52** | 9 | `EconomyShopGuiSellProducer` |
| **#53** | 10 | `ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md` |

**Do not merge #51–#53 without #44–#47** if you need shadow/read/alignment tooling on
the same jar line. For a minimal gameplay-sync-only jar, #51→#52 is the minimum
code path, but production rollout assumes the full stack through #47 for ops.

### Website / Supabase (not in RealCore jar)

| PR | Notes |
|----|--------|
| **#49** | Apply migration `202605270026` in Supabase **before** live write trials (not required for dry-run) |
| Lobby vote rewards | Separate track; **never** change as part of SMP gameplay RC |

## Recommended safe merge order

### A. Docs / migration / API prep (to `main`)

1. **#49** — economy transaction categories (migration + API)
2. **#50** — staged SMP gameplay write policy docs

Apply Supabase migration **#49** in a controlled window when ready (not part of
jar deploy). Dry-run SMP test does not require `can_earn` policy enablement.

### B. RealCore stack

Merge in order (or merge stacked PR #53 once if GitHub shows a single stack PR
into `main`):

1. **#44** → **#45** → **#46** → **#47** → **#51** → **#52** → **#53**

After **#53** is on `main`, `main` contains the full RC source for gameplay
economy sync (shadow through dry-run ops docs).

### C. After all PRs are on `main`

1. `git checkout main && git pull origin main`
2. Run **final release candidate checklist** (below)
3. Build **one** jar: `mvn -B -f realcore/pom.xml clean package`
4. Artifact: `realcore/target/RealCore-0.1.0-SNAPSHOT.jar`
5. Deploy that jar **only to SMP** first for dry-run validation
6. **Do not** deploy to Factions, Arcade, or Anarchy for this RC
7. **Do not** change Lobby1 jar initially (vote rewards isolated on Lobby1)

## Final release candidate checklist

Run from repo root on a clean `main` after all merges:

```bash
git checkout main
git pull origin main
npm run typecheck
npm run build
npm run build:cloudflare
mvn -B -f realcore/pom.xml test
mvn -B -f realcore/pom.xml clean package
git diff --check
```

Record in your ops log:

- `git rev-parse HEAD` (RC commit SHA)
- Jar path and file hash (`shasum realcore/target/RealCore-0.1.0-SNAPSHOT.jar`)
- Date/time and operator name

Optional: tag the commit in git after human sign-off (e.g.
`realcore-gameplay-economy-rc1`) — only if your release process uses tags.

## SMP deployment checklist (dry-run only)

Full detail: [ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md](ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md).

### Pre-deploy

- [ ] RC checklist passed on `main` SHA you are shipping
- [ ] Supabase: Phase 5 SMP read-only policy applied (`smp-1`, no `can_earn`)
- [ ] Supabase: Phase 6 categories migration applied if using category names in logs/SQL
- [ ] Phase 7 **write-trial SQL not run**
- [ ] Backup current SMP `plugins/RealCore/*.jar`
- [ ] Backup SMP `plugins/RealCore/config.yml` (or economy section)

### Deploy (SMP only)

- [ ] Install RC jar on **SMP** only
- [ ] **Lobby1 jar unchanged** on first RC pass
- [ ] Apply SMP dry-run config only (`gameplaySync.enabled=true`, all `dryRun=true`, `shopSell` on, producer on)
- [ ] **No** `can_earn` / `can_spend` in Supabase for `smp-1`
- [ ] Restart SMP (preferred) or reload per ops standard

### Verify in-game

- [ ] `/rf economy`
- [ ] `/rf economy gameplay`
- [ ] `/rf economy gameplay preflight dryrun` — summary **READY**
- [ ] `/rf economy gameplay producers` — hook listening, counters at baseline
- [ ] Record results in [ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md](ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md) (Phase 16)
- [ ] One small **EconomyShopGUI sell**
- [ ] Log contains `[GameplaySync:DRYRUN] server=smp-1 category=shop_sell ... source=EconomyShopGUI ...`
- [ ] `captured` and `dryRunCaptured` increment; **`queued` stays 0**
- [ ] No new `shop_sell` rows in `economy_ledger` (optional SQL in dry-run doc)
- [ ] Player Vault balance still changes from EconomyShopGUI (local economy normal)
- [ ] Lobby1 vote rewards unchanged (verify on Lobby1 separately if needed)

## Rollback checklist

If stop conditions trigger or test complete:

- [ ] SMP: `economy.gameplaySync.enabled: false`
- [ ] SMP: `economy.gameplaySync.producers.economyShopGuiSell.enabled: false`
- [ ] Reload or restart RealCore on SMP
- [ ] Restore previous jar if behavior abnormal
- [ ] **No DB ledger rollback** needed if dry-run only (no gameplay rows written)
- [ ] **Do not** change Lobby1 vote reward config as part of SMP rollback

## Stop conditions

Stop SMP test and roll back immediately if:

| Signal | Meaning |
|--------|---------|
| Vote reward behavior changes on Lobby1 | SMP/RC must not affect Lobby path |
| `queued` increments during dry-run | Live enqueue occurred — config or bug |
| `shop_sell` (or gameplay) ledger rows appear | Accidental write — stop |
| HTTP `/api/plugin/economy/transactions` from gameplay producer during dry-run | Must not happen |
| Error spam / hook registration failures | Unstable RC |
| `duplicateRejected` spikes without sells | Event loop or misconfiguration |
| Vault payouts stop on normal shop sells | Do not blame DB sync; roll back jar/config |
| SMP TPS/MSPT sustained drop | Operational risk |
| Anarchy shows gameplay economy enabled | Policy/config leak |

## Explicit non-goals (this RC)

- No real SMP gameplay ledger writes (`dryRun=false`, `can_earn=true`)
- No Factions or Arcade deployment of gameplay sync RC
- No Anarchy economy mutation (ever)
- No Vault economy provider registration yet
- No disabling Lobby1 vote reward fallback
- No automatic Vault↔DB reconciliation
- No `shop_buy` / `gameplay_spend` producers yet

## Related docs

| Doc | Purpose |
|-----|---------|
| [GAMEPLAY_ECONOMY_SYNC_DESIGN.md](GAMEPLAY_ECONOMY_SYNC_DESIGN.md) | Phase design index |
| [ECONOMY_TRANSACTION_CATEGORIES.md](ECONOMY_TRANSACTION_CATEGORIES.md) | Category ↔ policy mapping (#49) |
| [ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md](ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md) | Future live SMP policy (#50) |
| [ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md](ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md) | Producer (#52) |
| [ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md](ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md) | SMP dry-run ops (#53) |
| [ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md](ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md) | Phase 16 checklist + results template |
| [ECONOMY_GAMEPLAY_PREFLIGHT.md](ECONOMY_GAMEPLAY_PREFLIGHT.md) | Preflight before live writes (#57) |
| [ECONOMY_GAMEPLAY_OBSERVABILITY.md](ECONOMY_GAMEPLAY_OBSERVABILITY.md) | Observability before live writes (#13) |
| [ECONOMY_VOTE_REWARD_LEDGER_ROLLOUT.md](ECONOMY_VOTE_REWARD_LEDGER_ROLLOUT.md) | Lobby1 vote rewards (separate) |
