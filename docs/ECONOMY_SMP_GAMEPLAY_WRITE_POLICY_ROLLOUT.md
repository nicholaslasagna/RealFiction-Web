# SMP Gameplay Write Policy Rollout (Phase 7)

Phase 7 prepares a **documented, manual-only** path to enable capped SMP gameplay
economy writes later. It does **not** enable live gameplay sync, change RealCore,
or modify production `economy_server_policies` rows automatically.

## Purpose

After Phase 6 category support and Phase 5 SMP read-only access:

1. Operators have reviewed shadow output and reconciliation (Phases 1–2).
2. Category and policy mapping exist in the database (`gameplay_earn`, `shop_sell`,
   `gameplay_spend`, `shop_buy`, legacy `spend`).
3. SMP can read canonical balances but still cannot write.

Phase 7 adds **staged SQL and verification queries** so a future SMP write trial
can be turned on or off in one controlled step—without guessing policy values.

## Why writes are still disabled

Gameplay ledger sync is not production-ready until:

- RealCore gameplay producers and buffered flush are implemented and reviewed.
- Shadow deltas are understood and large unexplained drift is resolved.
- Vote rewards remain isolated on Lobby1 (`can_reward` only there).
- Staff agree on caps and stop conditions.

**Until those gates pass, do not run the enable SQL below.**

## Future target policy (manual enablement only)

When explicitly approved, `smp-1` should use:

| Field | Value |
|-------|--------|
| `enabled` | `true` |
| `can_read` | `true` |
| `can_reward` | `false` |
| `can_earn` | `true` |
| `can_spend` | `true` |
| `max_credit_minor` | `50000` ($500.00) |
| `max_debit_minor` | `50000` ($500.00) |
| `max_batch_count` | `100` |
| `notes` | SMP gameplay economy write trial. Capped earn/spend only; no rewards. |

Other backends must remain unchanged:

- **Lobby1**: live `can_reward` for vote rewards only.
- **Anarchy**: fully disabled; no mutations.
- **Factions / Arcade**: disabled unless separately reviewed.

Canonical SQL file: [`docs/sql/economy-smp-gameplay-write-trial.sql`](sql/economy-smp-gameplay-write-trial.sql)

## 1. Enable SMP write trial SQL

Run only after plugin producers and RealCore config are approved for trial.

```sql
update public.economy_server_policies
set
  server_group = 'smp',
  enabled = true,
  can_read = true,
  can_reward = false,
  can_earn = true,
  can_spend = true,
  max_credit_minor = 50000,
  max_debit_minor = 50000,
  max_batch_count = 100,
  notes = 'SMP gameplay economy write trial. Capped earn/spend only; no rewards.',
  updated_at = now()
where server_id = 'smp-1'
  and server_group = 'smp';
```

Then run verification queries in sections 3–6 below.

## 2. Disable SMP write trial SQL (rollback)

Immediate rollback to Phase 5 read-only SMP policy (no ledger edits):

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

Incorrect ledger entries from the trial require **compensating append-only**
entries (`admin_adjustment` or reviewed import rollback)—never direct balance
updates or ledger deletes.

## 3. Verify all economy_server_policies

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
  notes
from public.economy_server_policies
order by server_id;
```

**Before trial enable** — expected:

- `smp-1`: read-only (`can_earn=false`, `can_spend=false`, caps `0`).
- `lobby-1`: `can_reward=true` for live vote rewards.
- `anarchy-1`: disabled.
- `factions-1`, `arcade-1`: disabled.

**After trial enable** — expected:

- `smp-1`: caps as in target table above; `can_reward=false`.
- `lobby-1`: unchanged vote reward policy.
- All other servers: unchanged from pre-enable snapshot.

## 4. Verify SMP cannot use vote_reward

```sql
select *
from public.apply_economy_transaction(
  'smp-1',
  'smp',
  'realfiction_main',
  '<minecraft_uuid>',
  '<minecraft_username>',
  100,
  'vote_reward',
  'SMP vote_reward policy verification',
  'manual-smp-vote-reward-deny-' || gen_random_uuid()::text,
  'manual_test',
  'smp-vote-deny',
  '{"dry_run":true}'::jsonb
);
```

Expected error: `server smp-1 is not allowed to apply vote rewards`.

Run in its own session; use `rollback;` if wrapped in a failed transaction.

## 5. Verify Anarchy remains disabled

```sql
select
  server_id,
  server_group,
  enabled,
  can_read,
  can_reward,
  can_earn,
  can_spend
from public.economy_server_policies
where server_id = 'anarchy-1';
```

Expected: `enabled=false` and all capability flags false.

```sql
select *
from public.apply_economy_transaction(
  'anarchy-1',
  'anarchy',
  'realfiction_main',
  '<minecraft_uuid>',
  '<minecraft_username>',
  100,
  'gameplay_earn',
  'Anarchy deny verification',
  'manual-anarchy-deny-' || gen_random_uuid()::text,
  'manual_test',
  'anarchy-deny',
  '{"dry_run":true}'::jsonb
);
```

Expected error: `anarchy may not mutate the global economy` (or policy disabled).

## 6. Verify Lobby1 vote_reward policy remains intact

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
  notes
from public.economy_server_policies
where server_id = 'lobby-1';
```

Required for live vote rewards:

- `enabled = true`
- `can_reward = true`
- `max_credit_minor` at least the configured `vote.standard` amount
- `max_batch_count >= 1`
- `can_earn = false` and `can_spend = false` unless a separate reviewed rollout
  enabled them

Compare `updated_at` and flag values to a snapshot taken **before** any SMP
policy change. Lobby1 must not be updated by SMP trial SQL (the enable/disable
statements above are scoped to `server_id = 'smp-1'` only).

## Risks if enabled too early

| Risk | Mitigation |
|------|------------|
| Blind Vault deltas written as gameplay | Complete shadow review first; use explicit producers |
| Double-credit with EssentialsX | Trial caps; monitor ledger vs Vault |
| Vote reward confusion | Keep `can_reward=false` on SMP; verify section 4 |
| Over-cap batch abuse | `max_credit_minor` / `max_debit_minor` / `max_batch_count` |
| Anarchy leakage | Verify section 5 after any policy change |
| Lobby1 regression | Verify section 6 before and after SMP enable |

## Stop conditions

Disable SMP writes immediately (section 2) if any of the following occur:

- Unexplained ledger growth or wrong category on SMP.
- Vote reward behavior or Lobby1 policy changes unexpectedly.
- Anarchy or Factions/Arcade policy rows change without approval.
- HMAC/auth errors on economy routes.
- RealCore buffer drops batches or duplicate/divergence alerts spike.
- Any request to use `vault_mirror_adjustment` for automatic live sync.

## Prerequisites before enable SQL

1. Phase 6 migration applied (`202605270026_economy_transaction_categories.sql`).
2. Phase 5 SMP read-only policy applied (`202605250024_smp_readonly_economy_policy.sql`).
3. Shadow observer reviewed on SMP; reconciliation decisions documented.
4. RealCore gameplay producer + config rollout approved (later phase).
5. Staff snapshot of section 3 query saved for diff after enable.

## Related docs

- [`ECONOMY_SMP_READONLY_POLICY_ROLLOUT.md`](ECONOMY_SMP_READONLY_POLICY_ROLLOUT.md) — current read-only SMP
- [`ECONOMY_TRANSACTION_CATEGORIES.md`](ECONOMY_TRANSACTION_CATEGORIES.md) — category → policy mapping
- [`GAMEPLAY_ECONOMY_SYNC_DESIGN.md`](GAMEPLAY_ECONOMY_SYNC_DESIGN.md) — full rollout phases
- [`ECONOMY_VOTE_REWARD_LEDGER_ROLLOUT.md`](ECONOMY_VOTE_REWARD_LEDGER_ROLLOUT.md) — Lobby1 vote rewards
