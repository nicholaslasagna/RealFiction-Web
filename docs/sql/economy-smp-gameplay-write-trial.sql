-- SMP gameplay economy write trial — MANUAL OPERATOR SQL ONLY
--
-- This file is NOT a Supabase migration. Do not run via `supabase db push`.
-- Apply only after Phase 6 categories are live and shadow/reconciliation review
-- is complete. See docs/ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md
--
-- Phase 7 does not execute any of these statements automatically.

-- ---------------------------------------------------------------------------
-- 1) ENABLE SMP write trial (future manual enablement only)
-- ---------------------------------------------------------------------------
-- Target: capped gameplay earn/spend; vote_reward remains false for smp-1.
--
-- update public.economy_server_policies
-- set
--   server_group = 'smp',
--   enabled = true,
--   can_read = true,
--   can_reward = false,
--   can_earn = true,
--   can_spend = true,
--   max_credit_minor = 50000,
--   max_debit_minor = 50000,
--   max_batch_count = 100,
--   notes = 'SMP gameplay economy write trial. Capped earn/spend only; no rewards.',
--   updated_at = now()
-- where server_id = 'smp-1'
--   and server_group = 'smp';

-- ---------------------------------------------------------------------------
-- 2) DISABLE SMP write trial (immediate rollback to read-only)
-- ---------------------------------------------------------------------------
-- Reverts smp-1 to the Phase 5 read-only policy shape (migration 024).
--
-- update public.economy_server_policies
-- set
--   server_group = 'smp',
--   enabled = true,
--   can_read = true,
--   can_reward = false,
--   can_earn = false,
--   can_spend = false,
--   max_credit_minor = 0,
--   max_debit_minor = 0,
--   max_batch_count = 0,
--   notes = 'SMP read-only DB economy access for shadow/alignment rollout.',
--   updated_at = now()
-- where server_id = 'smp-1'
--   and server_group = 'smp';

-- ---------------------------------------------------------------------------
-- 3) VERIFY all economy_server_policies
-- ---------------------------------------------------------------------------
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
  notes,
  updated_at
from public.economy_server_policies
order by server_id;

-- ---------------------------------------------------------------------------
-- 4) VERIFY SMP cannot use vote_reward (expect failure)
-- ---------------------------------------------------------------------------
-- Run alone; on error in a transaction block: rollback;
--
-- select *
-- from public.apply_economy_transaction(
--   'smp-1',
--   'smp',
--   'realfiction_main',
--   '<minecraft_uuid>',
--   '<minecraft_username>',
--   100,
--   'vote_reward',
--   'SMP vote_reward policy verification',
--   'manual-smp-vote-reward-deny-' || gen_random_uuid()::text,
--   'manual_test',
--   'smp-vote-deny',
--   '{"dry_run":true}'::jsonb
-- );
-- Expected: server smp-1 is not allowed to apply vote rewards

-- ---------------------------------------------------------------------------
-- 5) VERIFY Anarchy remains disabled (no policy expansion)
-- ---------------------------------------------------------------------------
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
where server_id = 'anarchy-1';

-- Expected: enabled=false and all capability flags false (migration 018 default).
-- Mutation attempt must still fail at RPC layer even if misconfigured:
--
-- select *
-- from public.apply_economy_transaction(
--   'anarchy-1',
--   'anarchy',
--   'realfiction_main',
--   '<minecraft_uuid>',
--   '<minecraft_username>',
--   100,
--   'gameplay_earn',
--   'Anarchy deny verification',
--   'manual-anarchy-deny-' || gen_random_uuid()::text,
--   'manual_test',
--   'anarchy-deny',
--   '{"dry_run":true}'::jsonb
-- );
-- Expected: anarchy may not mutate the global economy

-- ---------------------------------------------------------------------------
-- 6) VERIFY Lobby1 vote_reward policy remains intact
-- ---------------------------------------------------------------------------
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

-- Expected (live vote rewards):
-- - enabled = true
-- - can_reward = true
-- - max_credit_minor >= vote.standard amount (typically >= 25000 minor)
-- - max_batch_count >= 1
-- - can_earn = false and can_spend = false unless a separate reviewed rollout changed them
