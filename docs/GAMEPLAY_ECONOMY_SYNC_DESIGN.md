# Gameplay Economy Sync Design

This document defines the safe path for moving non-vote gameplay economy
changes toward the DB-backed RealFiction global economy. Phase 1 is
shadow-only telemetry; real gameplay economy writes require a later review.

**Release coordination (Phase 11):** merge order, RC build checklist, SMP
dry-run deploy, rollback, and stop conditions are in
[`docs/REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md`](REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md).

## Current State

- Vote rewards are DB-ledger-backed and live through Lobby1.
- Held-review balances have been imported.
- The website economy leaderboard reads DB balances.
- Gameplay servers currently do not mutate the DB economy ledger.
- EssentialsX/Vault balances may differ from DB balances on SMP, Factions,
  Arcade, or Lobby1.
- `EconomyMirrorService` only reads Vault balances and mirrors them into the
  private `money.total` stat. It does not write the economy ledger.
- `stats.producers.economyMirror` is a read-only periodic Vault snapshot into
  the stats writer. It is off by default.
- `syncVaultAfterDb` is DB-to-Vault only, admin-command-only, one player at a
  time, and disabled by default.
- RealCore does not currently register a Vault economy provider.
- RealCore cannot currently observe exact Vault transactions. It can only poll
  or snapshot balances unless RealCore becomes the Vault provider or hooks
  specific gameplay producers later.
- Plugin/API categories (Phase 6): `vote_reward`, `gameplay_earn`,
  `gameplay_spend`, `shop_sell`, `shop_buy`, and legacy `spend`.
- Ledger-only categories: `admin_adjustment`, `migration_import`,
  `vault_mirror_adjustment` (manual/admin; not plugin routes).
- See `docs/ECONOMY_TRANSACTION_CATEGORIES.md` for policy mapping.

## Problem

Shops, sells, buys, and other gameplay economy changes on SMP or Factions still
occur in the local Vault/EssentialsX economy unless those systems are routed
through RealCore.

Polling Vault balances cannot reliably identify the exact cause of a balance
change. A delta could come from a shop sell, shop buy, command reward, staff
adjustment, plugin refund, or manual correction. Blindly mirroring those deltas
into the DB ledger risks:

- double-crediting players,
- overwriting legitimate DB state,
- hiding the real source of an economy change,
- importing historical balances more than once,
- creating ledger entries with the wrong category,
- confusing vote reward delivery with gameplay money flow.

The DB ledger must remain the source of truth. Any live sync must be append-only
and idempotent, not a direct balance overwrite.

## Architecture Options

### A. DB-Backed Vault Provider

RealCore becomes the Vault economy provider. Every Vault deposit or withdrawal
is translated into an append-only DB ledger transaction.

Benefits:

- Strongest long-term source-of-truth model.
- Other plugins can continue using Vault normally.
- DB balance, website balance, and in-game balance converge around one system.
- Transaction cause is known at the provider boundary.

Costs and risks:

- Requires careful migration away from EssentialsX economy authority.
- Requires plugin compatibility testing with shops, rewards, and other Vault
  consumers.
- Requires clear behavior for offline players, failures, retries, and local
  cache state.
- Should not be introduced until shadow testing and rollback tooling are proven.

### B. Plugin-Specific Integrations

RealCore hooks specific systems, such as shop or reward plugins, and writes DB
ledger transactions for known actions.

Benefits:

- Better transaction categories, such as `shop_sell` and `shop_buy`.
- Safer audit trail because the source action is explicit.
- Can be rolled out per plugin and per server.

Costs and risks:

- Requires per-plugin work and maintenance.
- Does not catch every Vault balance mutation.
- Still needs fallback behavior when a plugin action succeeds but the DB write
  fails.

### C. Vault Balance Delta Mirror

RealCore periodically compares local Vault balances against DB balances and
records the observed difference.

Benefits:

- Easy to run in shadow mode.
- Helps discover real-world drift between EssentialsX/Vault and DB balances.
- Can use existing read-only Vault access patterns.

Costs and risks:

- The cause of a delta is ambiguous.
- Real ledger writes from blind deltas can be incorrect.
- A repeated or stale baseline can create duplicate adjustments if not handled
  carefully.
- This should be treated as observation first, not production sync.

## Recommended Path

Do not implement immediate real Vault delta sync.

The first implementation should be a shadow-only Vault delta observer on SMP.
It should compare DB balance and local Vault balance, then log the delta only.
It must not write DB ledger entries, mutate Vault, ack rewards, or change vote
reward delivery.

Recommended first gameplay backend: SMP.

Rationale:

- SMP is the safer first gameplay economy backend than Factions.
- Factions is more competitive and higher risk for economy exploits.
- Lobby1 already owns vote reward ledger writes and should not become the first
  gameplay economy mutation backend.
- Arcade should stay small and capped later.
- Anarchy must never mutate the main economy.

## Phase 1 Shadow Implementation Requirements

The shadow observer should:

- default off,
- run on one backend only, preferably SMP,
- require `economy.enabled=true`,
- require an explicit config flag such as
  `economy.vaultDeltaShadowEnabled=true`,
- never write the DB ledger,
- never mutate Vault or EssentialsX,
- never change reward acknowledgement behavior,
- never touch vote reward delivery,
- never expose public balance or ledger data.

Initial config shape:

```yaml
economy:
  vaultDeltaShadowEnabled: false
  vaultDeltaShadowIntervalSeconds: 300
  vaultDeltaShadowMaxPlayersPerRun: 100
  vaultDeltaShadowMinDeltaMinor: 1
  vaultDeltaShadowMaxLoggedDeltaMinor: 250000
  vaultDeltaShadowBackendAllowlist:
    - smp-1
  shadow:
    warningDeltaMinor: 5000
    severeDeltaMinor: 50000
    ignoreNegativeOneMinorNoise: true
    repeatedOffenderThreshold: 5
    observationCacheSize: 500
```

Suggested logged fields:

- `serverId`
- `serverGroup`
- `minecraftUuid`
- `minecraftUsername`
- `vaultBalanceMinor`
- `dbBalanceMinor`
- `deltaMinor`
- `observedAt`
- `providerName`
- `shadowOnly=true`

The observer should cap, filter, or flag huge deltas rather than treating them
as normal. Large unexplained deltas should stop rollout until reviewed.

Phase 2 telemetry should aggregate enough signal for staff to decide whether a
real sync trial is safe:

- total sampled players,
- exact matches,
- positive and negative deltas,
- ignored and capped deltas,
- average absolute delta,
- largest absolute, positive, and negative deltas,
- repeated offenders from a bounded in-memory observation window,
- shadow run duration,
- DB balance read latency,
- Vault read latency.

The `/rf economy shadow` command is staff-only and should report these counters,
the backend allowlist, top repeated offenders, and an estimated health label.
Shadow logs should be structured key/value lines so staff can scrape or filter
them later. The cache must remain bounded; this is operational telemetry, not a
durable accounting source.

## Phase 3 DB Balance Read Path

Gameplay backends need a safe way to read the canonical DB balance before any
real gameplay sync is attempted. This path is read-only and uses the existing
signed plugin economy balance API. It does not add public endpoints, does not
write the ledger, and does not mutate Vault.

Config shape:

```yaml
economy:
  dbBalanceReadEnabled: false
  dbBalanceReadBackendAllowlist:
    - smp-1
  dbBalanceReadCacheSeconds: 30
  dbBalanceReadMaxPlayersPerBatch: 100
```

The DB policy row for the backend must have `enabled=true` and `can_read=true`.
No write capability (`can_reward`, `can_earn`, or `can_spend`) is required for
this phase. Anarchy remains blocked even if config is wrong.

The staff-only `/rf economy balance <online-player|uuid>` command can load the
canonical DB balance and compare it to the local Vault balance when a Vault
provider is available. It is diagnostic only.

For future 1000-player scale, real economy sync should be transaction/event
based, not a periodic full-player sync. Polling Vault balances is only shadow
telemetry for rollout discovery.

## Phase 4 Manual DB-to-Vault Alignment

After DB balance reads are available, staff can test a manual DB-to-Vault
alignment tool on SMP. This remains a local Vault/Essentials alignment step; it
does not write the DB ledger, does not create economy transactions, and does not
change vote reward delivery.

Config shape:

```yaml
economy:
  syncVaultFromDbEnabled: false
  syncVaultFromDbBackendAllowlist:
    - smp-1
  syncVaultFromDbMaxPlayersPerRun: 25
  syncVaultFromDbMaxDeltaMinor: 250000
  syncVaultFromDbRequireOnline: true
  syncVaultFromDbDryRunDefault: true
```

Commands:

```text
/rf economy syncfromdb <player|uuid> --dry-run
/rf economy syncfromdb <player|uuid> --apply
/rf economy syncfromdb --online --dry-run
/rf economy syncfromdb --online --apply
```

The command requires `modules.economy=true`, `economy.enabled=true`, the DB
balance read path, a Vault economy provider, a non-Anarchy backend, and an
allowlisted `server.id`. Dry-run remains the default. Apply mode can only align
the bounded target set and skips any player whose absolute delta is above
`syncVaultFromDbMaxDeltaMinor`.

## Future Real Implementation Requirements

Real writes must follow the existing global economy principles:

- DB ledger remains the source of truth.
- Balance changes are append-only ledger entries only.
- No direct balance edits.
- Idempotency is required for every transaction.
- Rollback uses compensating ledger entries only.
- No Anarchy mutations.
- No double-credit from vote rewards.
- No repeated historical import.
- No blind overwrite of imported balances.

Phase 6 (migration `202605270026`) added schema/API category support. Live
gameplay sync is still disabled by server policy defaults.

`vault_mirror_adjustment` is ledger-reserved for manual/admin reconciliation
only. It is rejected on plugin routes and must not be used for automatic live
sync.

Server policy must be enabled explicitly for the selected backend:

```sql
enabled = true
can_read = true
can_earn = true
can_spend = true
max_credit_minor = <safe cap>
max_debit_minor = <safe cap>
max_batch_count = <safe cap>
```

Anarchy must stay disabled at the DB/RPC, API, RealCore, and config layers.

## Rollout Plan

### Phase 6: Transaction category preparation

Schema/API category support only. No gameplay write enablement. See
`docs/ECONOMY_TRANSACTION_CATEGORIES.md`.

### Phase 7: SMP gameplay write policy preparation

Manual operator SQL for a future capped SMP write trial. See
`docs/ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md`.

### Phase 8: RealCore gameplay transaction buffer skeleton

`GameplayEconomyTransactionBuffer` validates future producer proposals and
optionally enqueues to `BufferedEconomyTransactionWriter`. Defaults:
`economy.gameplaySync.enabled=false`, `dryRun=true`. No Vault, shop, or command
producers are wired. Vote rewards remain on `VoteRewardLedgerWriteService`.

Future producers call `propose(...)` with explicit `source` and `eventId`.
Idempotency: `gameplay:<serverId>:<category>:<source>:<uuid>:<eventId>`.

Rollback: set `economy.gameplaySync.enabled=false` (and `dryRun=true`) and reload.

### Phase 9: SMP gameplay earn dry-run producer

First gameplay producer: **EconomyShopGUI sell** via `PostTransactionEvent` (reflection hook).
Defaults keep `gameplaySync.enabled=false`, producer `enabled=false`, and both `dryRun=true`.
No DB ledger writes occur unless all flags are explicitly enabled later.

Dry-run log format:

```text
[GameplaySync:DRYRUN] server=smp-1 category=shop_sell player=Alex(uuid) amountMinor=2500 source=EconomyShopGUI eventId=...
```

`shop_buy` / `gameplay_spend` are intentionally not implemented in this phase.

### Phase 22: EconomyShopGUI buy producer skeleton (code PR)

Disabled-by-default `economyShopGuiBuy` on `PostTransactionEvent` (BUY + SUCCESS).
See [ECONOMY_SHOP_BUY_SPEND_DESIGN_PHASE21.md](ECONOMY_SHOP_BUY_SPEND_DESIGN_PHASE21.md).

### Phase 23: SMP shop_buy dry-run ops plan

Operator checklist for SMP-only EconomyShopGUI **buy** capture validation: no DB
rows, `dryRun=true`, `can_spend` unchanged. Requires Phase 22 jar. See
[`ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md`](ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md).

### Phase 24: SMP shop_buy live ledger trial plan

Operator plan for **manual** policy SQL + `dryRun=false` single-buy trial after
Phase 23 passes. Docs only — no automatic `can_spend` or config changes in repo.
See [`ECONOMY_SMP_SHOP_BUY_LIVE_TRIAL.md`](ECONOMY_SMP_SHOP_BUY_LIVE_TRIAL.md).

### Phase 25: SMP combined shop_sell + shop_buy monitoring

After separate single-event live trials pass, run capped **combined** earn/spend
monitoring on `smp-1` only (`shop_sell` + `shop_buy`, no generic gameplay categories).
Docs/ops only. See
[`ECONOMY_SMP_EARN_SPEND_MONITORING_PHASE25.md`](ECONOMY_SMP_EARN_SPEND_MONITORING_PHASE25.md).

### Phase 26: Generic gameplay_earn / gameplay_spend design

Non-shop categories for quests, events, minigames, staff grants, and gameplay fees.
Design only — no producers, policy changes, or category enablement. See
[`ECONOMY_GENERIC_GAMEPLAY_EARN_SPEND_DESIGN_PHASE26.md`](ECONOMY_GENERIC_GAMEPLAY_EARN_SPEND_DESIGN_PHASE26.md).

### Phase 10: SMP shop_sell dry-run ops plan

Operator rollout to install Phase 8/9 jar on SMP and verify EconomyShopGUI sell
capture with no DB writes. See
`docs/ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md`.

### Phase 11: Merge order and release-candidate plan

Docs-only consolidation: PR dependency graph, safe merge sequence (#49/#50 then
RealCore stack #44–#53), final RC checklist (`npm` + `mvn`), SMP dry-run deploy
steps, rollback, stop conditions, and explicit non-goals. **No deploy in the
Phase 11 PR.** See
[`docs/REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md`](REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md).

### Phase 13: Gameplay economy observability

Batch/retry/duplicate/failure telemetry, gameplay-isolated writer metrics, queue
safety limits, structured `[GameplaySync:*]` logs, and expanded `/rf economy
gameplay` diagnostics. Defaults unchanged (`enabled=false`, `dryRun=true`). See
[`docs/ECONOMY_GAMEPLAY_OBSERVABILITY.md`](ECONOMY_GAMEPLAY_OBSERVABILITY.md).

### Phase 0: Design Only

Document current behavior, risks, and rollout criteria. Do not change code,
migrations, RealCore behavior, HMAC, reward delivery, or deployment settings.

### Phase 1: SMP Shadow Observer

Add a disabled-by-default SMP shadow observer that reads local Vault balances
and DB balances, compares them, and logs deltas. No writes.

### Phase 2: Manual Reconciliation

Review shadow output and reconcile unexplained differences. Confirm whether
SMP local economy is expected to move toward DB authority, whether specific
plugins need direct integrations, and whether any balances need compensating
ledger entries.

### Phase 3: Choose The Real Sync Strategy

Choose between:

- DB-backed Vault provider,
- plugin-specific integrations,
- a temporary, capped `vault_mirror_adjustment` delta bridge.

The DB-backed Vault provider remains the clean long-term target, but it should
not be the first live change.

### Phase 4: One-Server Real Write Trial

Enable one backend only with strict DB policy caps. Start with tiny amounts,
small batches, and explicit monitoring. Keep Anarchy disabled.

### Phase 5: Expand Later

Only expand to Factions, Arcade, or other producers after SMP shadow and trial
data are understood.

## Stop Conditions

Stop rollout immediately if any of these happen:

- any Anarchy mutation attempt,
- any vote reward behavior change,
- any unexplained Vault-to-DB delta,
- any fallback or double-credit risk,
- any DB/Vault divergence that staff cannot explain,
- any HMAC/auth regression,
- any ledger write with the wrong category,
- any direct balance overwrite,
- any public exposure of sensitive ledger or audit data.

## Explicit Non-Goals For The Phase 1 PR

- No DB ledger writes.
- No migrations.
- No Vault provider registration.
- No Vault or EssentialsX mutations.
- No reward behavior changes.
- No HMAC changes.
- No public money or ledger exposure.
- No deploy.
