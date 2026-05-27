-- Phase 6: expand economy transaction categories and policy mapping.
--
-- Additive migration only:
-- - extends ledger category constraint
-- - updates plugin category and policy assertion helpers
-- - does NOT change economy_server_policies rows
-- - does NOT enable gameplay writes on SMP/Factions/Arcade
-- - does NOT change vote reward delivery or RealCore behavior

alter table public.economy_ledger
  drop constraint if exists economy_ledger_category_allowed;

alter table public.economy_ledger
  add constraint economy_ledger_category_allowed check (
    category in (
      'vote_reward',
      'gameplay_earn',
      'gameplay_spend',
      'shop_sell',
      'shop_buy',
      'spend',
      'admin_adjustment',
      'migration_import',
      'vault_mirror_adjustment'
    )
  );

create or replace function public._economy_assert_plugin_category(p_category text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_category not in (
    'vote_reward',
    'gameplay_earn',
    'gameplay_spend',
    'shop_sell',
    'shop_buy',
    'spend'
  ) then
    raise exception 'category % is not accepted from plugin economy routes', p_category;
  end if;
end;
$$;

create or replace function public._economy_assert_policy(
  p_server_id text,
  p_server_group text,
  p_category text,
  p_amount_minor bigint,
  p_batch_count integer default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy public.economy_server_policies%rowtype;
  v_group text := lower(coalesce(nullif(p_server_group, ''), ''));
begin
  if p_server_id is null or p_server_id = '' then
    raise exception 'server_id is required';
  end if;

  if p_category in ('admin_adjustment', 'migration_import', 'vault_mirror_adjustment') then
    raise exception 'category % is not allowed through plugin policy checks', p_category;
  end if;

  select *
  into v_policy
  from public.economy_server_policies esp
  where esp.server_id = p_server_id;

  if not found then
    raise exception 'economy server policy is not configured for %', p_server_id;
  end if;

  if not v_policy.enabled then
    raise exception 'economy server policy is disabled for %', p_server_id;
  end if;

  if lower(v_policy.server_group) = 'anarchy' or v_group = 'anarchy' then
    raise exception 'anarchy may not mutate the global economy';
  end if;

  if p_server_group is not null and p_server_group <> '' and lower(v_policy.server_group) <> v_group then
    raise exception 'server group mismatch for %', p_server_id;
  end if;

  if coalesce(p_batch_count, 1) < 1 or coalesce(p_batch_count, 1) > v_policy.max_batch_count then
    raise exception 'economy batch size exceeds policy for %', p_server_id;
  end if;

  if p_amount_minor > 0 and p_amount_minor > v_policy.max_credit_minor then
    raise exception 'economy credit exceeds policy for %', p_server_id;
  end if;

  if p_amount_minor < 0 and abs(p_amount_minor) > v_policy.max_debit_minor then
    raise exception 'economy debit exceeds policy for %', p_server_id;
  end if;

  if p_category = 'batch' then
    return;
  elsif p_category = 'vote_reward' and not v_policy.can_reward then
    raise exception 'server % is not allowed to apply vote rewards', p_server_id;
  elsif p_category in ('gameplay_earn', 'shop_sell') and not v_policy.can_earn then
    raise exception 'server % is not allowed to apply gameplay earnings', p_server_id;
  elsif p_category in ('gameplay_spend', 'shop_buy', 'spend') and not v_policy.can_spend then
    raise exception 'server % is not allowed to apply spends', p_server_id;
  elsif p_category not in (
    'vote_reward',
    'gameplay_earn',
    'gameplay_spend',
    'shop_sell',
    'shop_buy',
    'spend'
  ) then
    raise exception 'category % is not allowed through plugin policy checks', p_category;
  end if;
end;
$$;
