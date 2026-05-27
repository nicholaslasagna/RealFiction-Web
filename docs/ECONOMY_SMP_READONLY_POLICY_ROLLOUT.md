# SMP Read-Only Economy Policy Rollout

This rollout enables `smp-1` to read canonical DB economy balances for shadow
and manual alignment testing. It does not allow SMP to write ledger entries.

## Apply

Apply only:

```text
supabase/migrations/202605250024_smp_readonly_economy_policy.sql
```

Do not use `supabase db push` if migration tracking is out of sync. Apply the
single migration manually in the RealFiction Supabase SQL Editor if needed.

## Expected Policy

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

Expected:

- `smp-1`: `enabled=true`, `can_read=true`, all write flags false, all caps `0`
- `lobby-1`: existing live vote reward policy remains unchanged
- `anarchy-1`: disabled
- `arcade-1` and `factions-1`: disabled unless separately approved

## Manual Verification

Read should work for `smp-1`:

```sql
select *
from public.get_plugin_economy_balance(
  'smp-1',
  'smp',
  'realfiction_main',
  '<minecraft_uuid>'
);
```

Writes should fail for `smp-1`:

```sql
select *
from public.apply_economy_transaction(
  'smp-1',
  'smp',
  'realfiction_main',
  '<minecraft_uuid>',
  '<minecraft_username>',
  1,
  'gameplay_earn',
  'SMP read-only policy verification',
  'manual-smp-readonly-write-test-' || gen_random_uuid()::text,
  'manual_test',
  'smp-readonly',
  '{"dry_run":true}'::jsonb
);
```

Expected error: `server smp-1 is not allowed to apply gameplay earnings`.

Anarchy read should fail:

```sql
select *
from public.get_plugin_economy_balance(
  'anarchy-1',
  'anarchy',
  'realfiction_main',
  '<minecraft_uuid>'
);
```

Expected error: `server anarchy-1 is not allowed to read economy balances`.

Run each expected-failure query separately. If it errors in a transaction block,
run:

```sql
rollback;
```

## Next phase

Phase 7 documents staged SQL to enable a **future** capped SMP gameplay write
trial. That phase does not change policy automatically. See
[`ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md`](ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md).

## Stop Conditions

Stop before enabling RealCore config if:

- `smp-1` has any write flag enabled
- `smp-1` has any non-zero write cap
- `anarchy-1` can read or write
- `lobby-1` vote reward policy changed unexpectedly
- any ledger or balance row changed during verification
