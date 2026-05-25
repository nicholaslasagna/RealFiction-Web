# Phase 6A: Vote Rewards to Economy Ledger Design

This is a design-only proposal. Do not implement this phase until approved.

No migrations, deploys, Vault provider changes, RealCore reward-flow changes,
or production configuration changes are part of this document.

## Goal

Move vote money rewards from local `eco give` command execution to the
append-only RealFiction economy ledger.

The target outcome is:

- Vote sites still send votes to the existing RealVoteBridge path.
- `/api/vote` still stores votes and queues reward delivery.
- RealCore still polls and acknowledges `reward_queue` entries.
- Money payout becomes a ledger transaction with idempotency by reward id.
- `economy_balances` remains a cache maintained only by RPCs.
- No direct balance edits, no deletes, and no floating-point money.

Currency remains integer minor units:

- `$1.00 = 100`
- `$250.00 = 25000`

## Current Boundary to Preserve

Current vote path:

```text
Vote site
  -> Velocity NuVotifier
  -> RealVoteBridge
  -> POST /api/vote
  -> votes stored idempotently
  -> reward_queue entry
  -> RealCore poller
  -> local reward delivery
  -> ack
```

Phase 6A must preserve the vote ingestion and reward reliability shape. The
ledger payout should not happen directly in RealVoteBridge or `/api/vote`.
Those layers should continue to record votes and enqueue rewards only.

The safest integration point is RealCore's reward delivery path:

```text
RealCore polls vote reward
  -> resolves reward amount/campaign
  -> sends economy transaction to plugin economy route
  -> treats applied or duplicate as successful payout
  -> runs non-money player messages/broadcasts
  -> marks reward delivered
  -> observer records vote stats
  -> ack reward_queue delivered
```

If the ledger write fails, RealCore should not acknowledge the reward as
delivered. It should fail/retry using the existing reward retry semantics.

## Architecture Proposal

### Vote Reward Ingestion

Keep `/api/vote` as an ingestion-only endpoint:

- Verify HMAC or legacy vote-secret fallback as currently designed.
- Normalize username, service site, timestamp, and source metadata.
- Store the vote idempotently.
- Queue reward entries in `reward_queue`.
- Do not write `economy_ledger`.
- Do not mutate `economy_balances`.

Vote ingestion is not the payout authority. It records that a vote happened.

### Payout Authority

RealCore remains the delivery authority for vote rewards because it already owns:

- reward polling
- idempotent delivery processing
- player/offline handling
- delivery logging
- reward ack ordering

For money vote rewards, RealCore should replace the current `eco give` command
handler with an economy transaction handler only after this design is approved
and implemented in a later phase.

The transaction category should be:

```text
vote_reward
```

This keeps the existing DB/RPC capability gate:

```text
vote_reward requires can_reward
```

Only approved servers should have `can_reward = true`. Anarchy remains blocked
from mutations by policy.

### Reliability Ordering

Recommended ordering for a vote money reward:

1. RealCore receives reward from `/api/plugin/rewards/poll`.
2. RealCore computes the intended ledger transaction from the reward payload.
3. RealCore submits the transaction using the existing buffered economy writer,
   but waits for a confirmed batch result for this reward before marking the
   reward as delivered.
4. If the economy route returns `applied` or `duplicate`, the money payout is
   considered successful.
5. RealCore records local delivery success, runs configured player messages and
   optional broadcasts.
6. Existing delivery observer runs.
7. RealCore acknowledges the reward as delivered.

Do not acknowledge a vote reward as delivered just because the transaction was
queued locally. The ledger write result must be known first.

### Idempotency

Use two layers:

1. Batch-level idempotency through `batch_id`.
2. Transaction-level idempotency through `idempotency_key`.

For vote reward transactions, the per-transaction idempotency key should be
derived from the immutable reward id:

```text
reward:<reward_id>:vote_reward:<currency_key>
```

For milestone bonuses:

```text
reward:<reward_id>:vote_milestone:<milestone>:<currency_key>
```

If reward ids are UUIDs, the key is stable across retries and server restarts.
If a reward is polled again after a crash, the same key should be reused and the
RPC should return duplicate/no-op instead of paying twice.

Batch ids should be stable for retry of a queued batch. A regenerated batch may
still be safe because per-transaction idempotency protects duplicates, but the
writer should preserve batch ids across retry whenever possible.

### Duplicate Vote Prevention

Duplicate vote prevention remains layered:

- RealVoteBridge forwards exactly what NuVotifier receives.
- `/api/vote` stores votes idempotently using the vote source identity.
- `reward_queue` should not create duplicate rewards for the same accepted vote.
- Economy ledger idempotency prevents duplicate payouts if a reward is retried.

The ledger should not rely on vote-site uniqueness alone. The reward id is the
stronger payout idempotency boundary.

### Reward Campaigns and Multipliers

Campaigns should be DB-configured, not hardcoded in RealCore long term.

Examples:

- weekend double vote rewards
- site-specific bonus days
- rank/supporter cosmetic-only multipliers if ever approved
- milestone bonuses
- event campaigns

Campaign rules should produce deterministic metadata and idempotency keys.

Example payout composition:

```text
base vote reward: 25000 minor units
campaign multiplier: 2.0
final amount: 50000 minor units
```

Store multipliers as integer basis points, not floats:

```text
10000 = 1.0x
15000 = 1.5x
20000 = 2.0x
```

Final calculation:

```text
final_minor = floor(base_minor * multiplier_basis_points / 10000)
```

If multiple campaigns can apply, define deterministic combination rules:

- v1 recommended: choose the highest active multiplier only.
- Later: allow additive bonus transactions as separate ledger entries.

## Recommended Tables

### `vote_reward_campaigns`

Purpose: define active vote reward campaigns without changing RealCore jars.

Suggested fields:

```text
id uuid primary key
campaign_key text unique not null
name text not null
enabled boolean not null default false
starts_at timestamptz
ends_at timestamptz
base_reward_minor bigint not null
multiplier_basis_points integer not null default 10000
max_reward_minor bigint not null
applies_to_sites text[] null
applies_to_server_groups text[] null
priority integer not null default 0
metadata jsonb not null default '{}'
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Important constraints:

- `base_reward_minor >= 0`
- `multiplier_basis_points >= 0`
- `max_reward_minor >= base_reward_minor`
- no floating-point columns

### `vote_reward_payouts`

Purpose: optional audit join between reward delivery and economy ledger rows.

This table is not required for correctness if `economy_ledger.metadata` is
rich enough, but it makes operational audits easier.

Suggested fields:

```text
id uuid primary key
reward_id uuid not null unique
vote_id uuid
ledger_id uuid unique
currency_key text not null
minecraft_uuid text not null
minecraft_username text
vote_site text
campaign_key text
base_reward_minor bigint not null
multiplier_basis_points integer not null
final_reward_minor bigint not null
status text not null
metadata jsonb not null default '{}'
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Recommended statuses:

```text
pending
ledger_applied
ledger_duplicate
failed
rolled_back
```

Do not use this table to mutate balances. It is audit state only.

### Existing Tables Reused

Use existing economy tables:

- `economy_ledger`
- `economy_balances`
- `economy_transaction_batches`
- `economy_server_policies`
- `economy_admin_audit`

Use existing vote/reward tables:

- vote storage table
- `reward_queue`

Do not make a second balance table for vote rewards.

## Recommended Indexes

Campaign lookup:

```text
vote_reward_campaigns(enabled, starts_at, ends_at, priority)
vote_reward_campaigns(campaign_key)
```

Payout audit:

```text
vote_reward_payouts(reward_id)
vote_reward_payouts(ledger_id)
vote_reward_payouts(minecraft_uuid, created_at desc)
vote_reward_payouts(vote_site, created_at desc)
vote_reward_payouts(status, created_at desc)
```

Ledger audit queries should use existing or future indexes for:

```text
economy_ledger(category, created_at desc)
economy_ledger(external_ref_type, external_ref_id)
economy_ledger(minecraft_uuid, currency_key, created_at desc)
economy_ledger(idempotency_key)
```

## Recommended RPCs and Functions

### `resolve_vote_reward_payout(...)`

Purpose: compute the intended vote payout from a reward id and vote metadata.

This can be either:

- server-side RPC used by API routes, or
- internal API logic backed by campaign tables.

Inputs:

```text
reward_id uuid
vote_id uuid
vote_site text
server_id text
server_group text
currency_key text
```

Output:

```text
currency_key
base_reward_minor
multiplier_basis_points
final_reward_minor
campaign_key
metadata
```

Rules:

- reject if reward is not a vote reward
- reject if reward already has a terminal payout audit row unless duplicate
- use integer minor units only
- apply only enabled campaigns within time window

### `record_vote_reward_payout(...)`

Purpose: create/update `vote_reward_payouts` audit state after ledger write.

This should be service-role only. It should not update balances directly.

### Existing `apply_economy_batch(...)`

Use existing category:

```text
vote_reward
```

Do not create a special bypass for vote rewards. Capability checks and limits
must stay enforced by `economy_server_policies`.

### Optional Campaign Admin RPCs

V1 can seed campaigns manually by migration. Later admin tooling can add:

```text
admin_create_vote_reward_campaign(...)
admin_update_vote_reward_campaign(...)
admin_disable_vote_reward_campaign(...)
```

These must be audited and service/admin-only.

## Metadata Schema

Every vote ledger transaction should include enough metadata to explain the
payout without joining multiple systems.

Recommended `economy_ledger.metadata`:

```json
{
  "sourceSystem": "realcore",
  "rewardId": "<reward_queue uuid>",
  "voteId": "<vote uuid if available>",
  "voteSite": "mclist.io",
  "voteServiceName": "mclist.io",
  "rewardKey": "vote.standard",
  "campaignKey": "standard_vote_v1",
  "baseRewardMinor": 25000,
  "multiplierBasisPoints": 10000,
  "finalRewardMinor": 25000,
  "serverId": "lobby-1",
  "serverGroup": "lobby",
  "deliveryAttempt": 1,
  "realCoreInstanceId": "<instance uuid>"
}
```

Recommended `external_ref_type`:

```text
reward_queue
```

Recommended `external_ref_id`:

```text
<reward_id>
```

## Reward Source Taxonomy

Use stable categories and metadata source fields.

Economy category:

```text
vote_reward
```

Metadata source taxonomy:

```text
sourceSystem: realcore
sourceType: vote
sourceSubType: standard_vote
sourceSubType: milestone_bonus
sourceSubType: campaign_bonus
sourceSubType: manual_vote_repair
```

Do not add `admin_adjustment` or `migration_import` through plugin routes.

Milestones can either be:

1. separate reward queue entries, each with its own ledger transaction, or
2. one standard vote reward plus additional bonus transactions from the same
   reward id with distinct idempotency suffixes.

Recommendation: keep milestone bonuses as separate reward queue entries if that
is already how the reward queue works. It keeps delivery, retry, and audit
simple.

## Anti-Abuse Protections

Keep all existing protections:

- HMAC auth
- timestamp checks
- nonce replay protection
- server id bound to signature
- service-role-only write RPCs
- reward queue idempotency

Add or enforce:

- per-server `can_reward` must be true for vote ledger writes
- per-server `max_credit_minor` caps vote payouts
- `max_batch_count` limits RealCore batch size
- campaign `max_reward_minor` caps multipliers
- duplicate idempotency by reward id
- vote-site cooldown/idempotency remains in `/api/vote`
- no Anarchy mutations even with valid HMAC
- monitoring for repeated duplicate reward attempts
- monitoring for unexpected vote reward amounts

Recommended first cap:

```text
max_credit_minor = 250000
```

That permits `$2,500.00` milestone-style bonuses while blocking unexpected
large payouts. Adjust only after reviewing actual configured milestones.

## Offline Player Support

Ledger writes do not require the player to be online.

For offline vote rewards:

- RealCore can submit the ledger transaction for the UUID/username from the
  reward payload.
- Player-facing messages can be skipped or stored for later if a future message
  inbox exists.
- The reward can still be acked delivered after ledger success.

If RealCore requires player lookup for UUID resolution, that lookup must happen
before payout and must not touch Bukkit APIs from async threads on Folia.

## Eventual Vault Compatibility

This phase should not register RealCore as a Vault provider.

The design should prepare for the future provider phase:

- Ledger transaction becomes the canonical money movement.
- `economy_balances` becomes the source for `/money`.
- RealCore Vault provider later routes deposits/withdrawals through the same
  ledger path.
- Vote rewards should already be ledger-native by the time Vault provider work
  begins.

When RealCore becomes the Vault provider later, vote rewards should not need a
second migration. They will already be canonical ledger events.

## Rollback Safety

Never delete vote reward ledger entries.

Rollback model:

- identify bad ledger rows by `category = vote_reward`
- narrow by `rewardId`, `voteId`, `campaignKey`, or batch id metadata
- create compensating entries with negative `amount_minor`
- use stable rollback idempotency keys
- mark payout audit rows as `rolled_back`

Example rollback idempotency key:

```text
vote-reward-rollback:<ledger_id>:<rollback_batch_id>
```

Rollback must reject if it would make balances negative unless explicitly
approved in a later overdraft policy. V1 should keep no-overdraft behavior.

## Migration Plan

Add a future additive migration only after approval.

Potential migration contents:

1. `vote_reward_campaigns`
2. optional `vote_reward_payouts`
3. indexes listed above
4. RLS enabled on new tables
5. no anon/authenticated writes
6. admin SELECT-only policies if needed
7. service-role-only RPC grants
8. seed a disabled standard campaign or no campaigns by default

Do not modify existing migrations.

Do not change existing reward queue schema unless a concrete contract gap is
found.

## Phased Rollout

### Phase 6A: Design

This document only.

### Phase 6B: DB/API Foundation

Add campaign and payout audit tables/RPCs.

No RealCore behavior changes.

### Phase 6C: RealCore Dry-Run Mode

Add a RealCore config flag:

```yaml
economy:
  voteRewardsToLedger: false
  voteRewardsLedgerDryRun: true
```

Dry-run should resolve intended ledger transactions and log them, but continue
using existing reward behavior.

### Phase 6D: One-Server Shadow Mode

On Lobby1 only:

- keep existing `eco give` active
- submit dry-run or non-mutating audit records
- compare intended ledger payouts to actual command rewards

No balance mutation yet.

### Phase 6E: Controlled Ledger Payout

On Lobby1 only:

- enable `can_reward`
- set conservative caps
- disable `eco give` for vote rewards on that backend
- require ledger success before reward ack
- monitor duplicates and failed ledger writes

### Phase 6F: Network Rollout

After Lobby1 is stable:

- decide whether only Lobby1 processes vote money rewards, or whether all
  reward-capable servers can do it with strict idempotency
- keep Anarchy disabled
- remove local `eco give` vote money rewards everywhere

## RealCore Integration Boundary

RealCore should add a reward handler type for ledger payouts.

Suggested config shape:

```yaml
economy:
  voteRewardsToLedger: false
  voteRewardsLedgerDryRun: true

rewards:
  economy:
    byRewardKey:
      vote.standard:
        amountMinor: 25000
        currencyKey: realfiction_main
        category: vote_reward
      vote.milestone.5:
        amountMinor: 50000
        currencyKey: realfiction_main
        category: vote_reward
```

When `voteRewardsToLedger = false`, existing command behavior remains.

When enabled:

- do not call Vault or EssentialsX directly
- submit to plugin economy transaction route
- wait for applied/duplicate result
- then mark delivery success and ack

HTTP remains async. Bukkit/Folia player messaging must use the existing
scheduler abstraction.

## Risk Analysis

### Double Payout

Risk: reward retry pays twice.

Mitigation:

- idempotency key based on reward id
- batch id retry dedupe
- ack only after ledger applied/duplicate

### Lost Payout

Risk: ledger succeeds but ack fails.

Mitigation:

- on retry, ledger returns duplicate
- RealCore can safely ack delivered after duplicate result

### Vote Ingestion Abuse

Risk: duplicate vote callbacks create multiple queued rewards.

Mitigation:

- keep `/api/vote` idempotency
- reward id remains payout boundary
- monitor duplicate vote attempts

### Campaign Misconfiguration

Risk: multiplier pays too much.

Mitigation:

- integer basis points
- campaign `max_reward_minor`
- server `max_credit_minor`
- disabled-by-default campaigns

### Compromised Backend

Risk: backend with HMAC key submits fake vote rewards.

Mitigation:

- `can_reward` only on approved server ids
- amount caps
- category gates
- Anarchy blocked in RPC
- metadata audits source server and reward id

### Rollback Error

Risk: staff rolls back the wrong batch.

Mitigation:

- dry-run rollback first
- compensating entries only
- require reason and actor
- never delete ledger rows

## Open Questions

1. Should Lobby1 be the only vote money reward payout authority, or should any
   server that polls a vote reward be allowed to submit `vote_reward` ledger
   entries?
2. Should campaign resolution live in the website/RPC layer or in RealCore
   config for the first implementation?
3. Should vote milestone bonuses remain separate reward queue entries, or be
   generated as multiple ledger transactions from one reward?
4. What should the initial `max_credit_minor` be for vote rewards after current
   milestones are accounted for?
5. Should offline players receive pending message notifications later, or is
   ledger payout without message enough?

## Recommendation

Use RealCore reward delivery as the payout boundary, not `/api/vote`.

The first implementation after approval should be DB/API foundation only:

- campaign table
- optional payout audit table
- service-role-only resolution/audit RPCs
- no RealCore behavior change
- no reward flow change
- no Vault provider
- no production enablement

After that, add RealCore dry-run and shadow modes before replacing `eco give`
vote rewards with ledger transactions.
