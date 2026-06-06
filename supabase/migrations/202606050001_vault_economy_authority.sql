-- Phase 2: RealCore as the network's Vault economy authority.
--
-- Adds a `vault` ledger category for authoritative balance writes from a backend
-- that has been made the live economy (RealCore registered as the Vault provider).
-- Unlike the capped gameplay categories, `vault` writes are UNCAPPED — they are the
-- player's real deposits/withdrawals (parkour, shop, /pay, etc.) — but they are
-- gated behind a new explicit policy flag `can_be_authority`, so only a backend the
-- operator has deliberately promoted can make them.
--
-- Additive only: does not change existing rows, gameplay categories, caps, vote
-- rewards, or any current RealCore behavior. `can_be_authority` defaults false, so
-- nothing can make uncapped writes until an operator opts a server in.

alter table public.economy_server_policies
  add column if not exists can_be_authority boolean not null default false;

comment on column public.economy_server_policies.can_be_authority is
  'When true, this backend may apply uncapped authoritative `vault` balance writes '
  '(it is the live Vault economy for the network). Enable only on the promoted backend(s).';

-- Allow `vault` rows on the ledger.
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
      'vault',
      'admin_adjustment',
      'migration_import',
      'vault_mirror_adjustment'
    )
  );

-- Accept `vault` from plugin economy routes.
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
    'spend',
    'vault'
  ) then
    raise exception 'category % is not accepted from plugin economy routes', p_category;
  end if;
end;
$$;

-- Policy gate: `vault` requires can_be_authority and is intentionally UNCAPPED
-- (it is the authoritative balance, not a capped reward). All other categories
-- keep their existing caps and can_reward/can_earn/can_spend checks unchanged.
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

  -- Authoritative economy writes: gated by can_be_authority, uncapped. Handled
  -- before the gameplay cap checks so the real economy is never throttled.
  if p_category = 'vault' then
    if not v_policy.can_be_authority then
      raise exception 'server % is not allowed to be the economy authority', p_server_id;
    end if;
    if coalesce(p_batch_count, 1) < 1 then
      raise exception 'economy batch size is invalid for %', p_server_id;
    end if;
    return;
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
