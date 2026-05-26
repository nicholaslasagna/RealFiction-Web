-- Enable SMP read-only access to canonical DB economy balances.
--
-- Additive and policy-only:
-- - does not edit ledger rows
-- - does not edit balance rows
-- - does not grant gameplay/vote/spend mutation capability
-- - does not change Lobby, Arcade, Factions, or Anarchy policy rows
--
-- Manual post-apply verification:
--
-- select
--   server_id,
--   server_group,
--   enabled,
--   can_read,
--   can_reward,
--   can_earn,
--   can_spend,
--   max_credit_minor,
--   max_debit_minor,
--   max_batch_count,
--   notes
-- from public.economy_server_policies
-- order by server_id;
--
-- Expected production state:
-- - smp-1: enabled=true, can_read=true, all write capabilities false, all caps 0
-- - lobby-1: existing live reward policy remains unchanged
-- - anarchy-1: disabled and unable to read/write
-- - arcade-1/factions-1: disabled unless intentionally enabled by another reviewed rollout

insert into public.economy_server_policies (
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
  created_at,
  updated_at
) values (
  'smp-1',
  'smp',
  true,
  true,
  false,
  false,
  false,
  0,
  0,
  0,
  'SMP read-only DB economy access for shadow/alignment rollout.',
  now(),
  now()
)
on conflict (server_id) do update set
  server_group = excluded.server_group,
  enabled = excluded.enabled,
  can_read = excluded.can_read,
  can_reward = excluded.can_reward,
  can_earn = excluded.can_earn,
  can_spend = excluded.can_spend,
  max_credit_minor = excluded.max_credit_minor,
  max_debit_minor = excluded.max_debit_minor,
  max_batch_count = excluded.max_batch_count,
  notes = excluded.notes,
  updated_at = now();
