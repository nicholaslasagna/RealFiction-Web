-- Global economy foundation.
--
-- Additive only. Does not modify migrations 014-017, reward delivery, playtime,
-- network stats, or the existing money.total diagnostic stat mirror.
--
-- Currency amounts use integer minor units:
--   $1.00   = 100
--   $250.00 = 25000
--
-- This migration creates the DB-owned ledger foundation, but no live RealCore
-- behavior changes are enabled by this migration alone.

-- Tables --------------------------------------------------------------------

create table if not exists public.economy_server_policies (
  server_id text primary key,
  server_group text not null,
  enabled boolean not null default false,
  can_read boolean not null default false,
  can_reward boolean not null default false,
  can_earn boolean not null default false,
  can_spend boolean not null default false,
  max_credit_minor bigint not null default 0,
  max_debit_minor bigint not null default 0,
  max_batch_count integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint economy_server_policies_group_shape check (server_group ~ '^[a-z0-9_.-]{2,80}$'),
  constraint economy_server_policies_credit_nonnegative check (max_credit_minor >= 0),
  constraint economy_server_policies_debit_nonnegative check (max_debit_minor >= 0),
  constraint economy_server_policies_batch_nonnegative check (max_batch_count >= 0)
);

create table if not exists public.economy_balances (
  currency_key text not null default 'realfiction_main',
  minecraft_uuid text not null,
  minecraft_username text,
  balance_minor bigint not null default 0,
  last_ledger_id uuid,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (currency_key, minecraft_uuid),
  constraint economy_balances_currency_shape check (currency_key ~ '^[a-z0-9_.-]{2,80}$'),
  constraint economy_balances_uuid_shape check (minecraft_uuid ~ '^[A-Za-z0-9_.:-]{8,48}$'),
  constraint economy_balances_nonnegative check (balance_minor >= 0)
);

create table if not exists public.economy_ledger (
  id uuid primary key default gen_random_uuid(),
  currency_key text not null default 'realfiction_main',
  minecraft_uuid text not null,
  minecraft_username text,
  amount_minor bigint not null,
  balance_after_minor bigint not null,
  category text not null,
  reason text not null,
  idempotency_key text not null,
  source text not null default 'plugin',
  source_server_id text,
  source_server_group text,
  external_ref_type text,
  external_ref_id text,
  actor_type text not null default 'plugin',
  actor_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint economy_ledger_currency_shape check (currency_key ~ '^[a-z0-9_.-]{2,80}$'),
  constraint economy_ledger_uuid_shape check (minecraft_uuid ~ '^[A-Za-z0-9_.:-]{8,48}$'),
  constraint economy_ledger_amount_nonzero check (amount_minor <> 0),
  constraint economy_ledger_balance_nonnegative check (balance_after_minor >= 0),
  constraint economy_ledger_category_allowed check (
    category in (
      'vote_reward',
      'gameplay_earn',
      'spend',
      'admin_adjustment',
      'migration_import'
    )
  ),
  constraint economy_ledger_source_allowed check (source in ('plugin', 'admin', 'migration', 'system')),
  constraint economy_ledger_actor_allowed check (actor_type in ('plugin', 'admin', 'migration', 'system')),
  constraint economy_ledger_metadata_object check (jsonb_typeof(metadata) = 'object'),
  unique (currency_key, idempotency_key)
);

create index if not exists economy_ledger_player_idx
  on public.economy_ledger (minecraft_uuid, currency_key, created_at desc);

create index if not exists economy_ledger_source_server_idx
  on public.economy_ledger (source_server_id, created_at desc);

create index if not exists economy_ledger_category_idx
  on public.economy_ledger (category, created_at desc);

create table if not exists public.economy_transaction_batches (
  batch_id uuid primary key,
  server_id text not null,
  currency_key text not null default 'realfiction_main',
  submitted_count integer not null default 0,
  applied_count integer not null default 0,
  duplicate_count integer not null default 0,
  status text not null default 'applied',
  created_at timestamptz not null default now(),
  constraint economy_transaction_batches_status_allowed check (status in ('applied', 'duplicate')),
  constraint economy_transaction_batches_count_nonnegative check (
    submitted_count >= 0 and applied_count >= 0 and duplicate_count >= 0
  )
);

create index if not exists economy_transaction_batches_server_idx
  on public.economy_transaction_batches (server_id, created_at desc);

create table if not exists public.economy_admin_audit (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid,
  target_minecraft_uuid text not null,
  currency_key text not null default 'realfiction_main',
  amount_minor bigint not null,
  previous_balance_minor bigint not null,
  new_balance_minor bigint not null,
  reason text not null,
  ledger_id uuid references public.economy_ledger(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint economy_admin_audit_nonnegative check (previous_balance_minor >= 0 and new_balance_minor >= 0),
  constraint economy_admin_audit_metadata_object check (jsonb_typeof(metadata) = 'object')
);

alter table public.economy_ledger enable row level security;
alter table public.economy_balances enable row level security;
alter table public.economy_transaction_batches enable row level security;
alter table public.economy_server_policies enable row level security;
alter table public.economy_admin_audit enable row level security;

-- Economy tables are RPC-owned. Authenticated/admin users may read for staff
-- dashboards, but direct inserts/updates/deletes are intentionally not exposed.
-- Mutations must go through service-role RPCs so every balance change is
-- idempotent, policy-checked, and audited.
revoke all on table public.economy_ledger from public, anon, authenticated;
revoke all on table public.economy_balances from public, anon, authenticated;
revoke all on table public.economy_transaction_batches from public, anon, authenticated;
revoke all on table public.economy_server_policies from public, anon, authenticated;
revoke all on table public.economy_admin_audit from public, anon, authenticated;

grant select on table public.economy_ledger to authenticated;
grant select on table public.economy_balances to authenticated;
grant select on table public.economy_transaction_batches to authenticated;
grant select on table public.economy_server_policies to authenticated;
grant select on table public.economy_admin_audit to authenticated;

drop policy if exists "economy_ledger_admin" on public.economy_ledger;
drop policy if exists "economy_ledger_admin_select" on public.economy_ledger;
create policy "economy_ledger_admin_select" on public.economy_ledger for select
  using (public.is_admin());

drop policy if exists "economy_balances_admin" on public.economy_balances;
drop policy if exists "economy_balances_admin_select" on public.economy_balances;
create policy "economy_balances_admin_select" on public.economy_balances for select
  using (public.is_admin());

drop policy if exists "economy_transaction_batches_admin" on public.economy_transaction_batches;
drop policy if exists "economy_transaction_batches_admin_select" on public.economy_transaction_batches;
create policy "economy_transaction_batches_admin_select" on public.economy_transaction_batches for select
  using (public.is_admin());

drop policy if exists "economy_server_policies_admin" on public.economy_server_policies;
drop policy if exists "economy_server_policies_admin_select" on public.economy_server_policies;
create policy "economy_server_policies_admin_select" on public.economy_server_policies for select
  using (public.is_admin());

drop policy if exists "economy_admin_audit_admin" on public.economy_admin_audit;
drop policy if exists "economy_admin_audit_admin_select" on public.economy_admin_audit;
create policy "economy_admin_audit_admin_select" on public.economy_admin_audit for select
  using (public.is_admin());

-- Conservative disabled defaults. Operators must explicitly enable a backend
-- before any plugin economy write can land. Anarchy is present and disabled so
-- the policy block is visible in production data.
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
  notes
) values
  ('lobby-1', 'lobby', false, false, false, false, false, 0, 0, 0, 'Disabled default; enable intentionally after staging validation.'),
  ('arcade-1', 'arcade', false, false, false, false, false, 0, 0, 0, 'Disabled default; arcade should use small capped rewards only after approval.'),
  ('smp-1', 'smp', false, false, false, false, false, 0, 0, 0, 'Disabled default; candidate gameplay economy backend after import.'),
  ('factions-1', 'factions', false, false, false, false, false, 0, 0, 0, 'Disabled default; enable carefully after policy review.'),
  ('anarchy-1', 'anarchy', false, false, false, false, false, 0, 0, 0, 'Anarchy must not mutate the global economy.')
on conflict (server_id) do nothing;

-- Helpers -------------------------------------------------------------------

create or replace function public._economy_assert_plugin_category(p_category text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_category not in ('vote_reward', 'gameplay_earn', 'spend') then
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
  elsif p_category = 'gameplay_earn' and not v_policy.can_earn then
    raise exception 'server % is not allowed to apply gameplay earnings', p_server_id;
  elsif p_category = 'spend' and not v_policy.can_spend then
    raise exception 'server % is not allowed to apply spends', p_server_id;
  elsif p_category not in ('vote_reward', 'gameplay_earn', 'spend') then
    raise exception 'category % is not allowed through plugin policy checks', p_category;
  end if;
end;
$$;

-- RPCs ----------------------------------------------------------------------

create or replace function public.get_economy_balance(
  p_currency_key text,
  p_minecraft_uuid text
)
returns table(
  currency_key text,
  minecraft_uuid text,
  minecraft_username text,
  balance_minor bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_currency text := lower(coalesce(nullif(p_currency_key, ''), 'realfiction_main'));
begin
  if p_minecraft_uuid is null or p_minecraft_uuid = '' then
    raise exception 'minecraft_uuid is required';
  end if;

  return query
  select
    v_currency,
    p_minecraft_uuid,
    eb.minecraft_username,
    coalesce(eb.balance_minor, 0)::bigint,
    eb.updated_at
  from (select 1) s
  left join public.economy_balances eb
    on eb.currency_key = v_currency
   and eb.minecraft_uuid = p_minecraft_uuid;
end;
$$;

create or replace function public.get_plugin_economy_balance(
  p_server_id text,
  p_server_group text,
  p_currency_key text,
  p_minecraft_uuid text
)
returns table(
  currency_key text,
  minecraft_uuid text,
  minecraft_username text,
  balance_minor bigint,
  updated_at timestamptz
)
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

  select *
  into v_policy
  from public.economy_server_policies esp
  where esp.server_id = p_server_id;

  if not found or not v_policy.enabled or not v_policy.can_read then
    raise exception 'server % is not allowed to read economy balances', p_server_id;
  end if;

  if p_server_group is not null and p_server_group <> '' and lower(v_policy.server_group) <> v_group then
    raise exception 'server group mismatch for %', p_server_id;
  end if;

  return query
  select *
  from public.get_economy_balance(p_currency_key, p_minecraft_uuid);
end;
$$;

create or replace function public.apply_economy_transaction(
  p_server_id text,
  p_server_group text,
  p_currency_key text,
  p_minecraft_uuid text,
  p_minecraft_username text,
  p_amount_minor bigint,
  p_category text,
  p_reason text,
  p_idempotency_key text,
  p_external_ref_type text default null,
  p_external_ref_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table(
  ledger_id uuid,
  balance_minor bigint,
  duplicate boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_currency text := lower(coalesce(nullif(p_currency_key, ''), 'realfiction_main'));
  v_category text := lower(coalesce(nullif(p_category, ''), ''));
  v_reason text := coalesce(nullif(p_reason, ''), v_category);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_existing public.economy_ledger%rowtype;
  v_balance public.economy_balances%rowtype;
  v_new_balance bigint;
  v_ledger_id uuid;
begin
  perform public._economy_assert_plugin_category(v_category);
  perform public._economy_assert_policy(p_server_id, p_server_group, v_category, p_amount_minor, 1);

  if p_minecraft_uuid is null or p_minecraft_uuid = '' then
    raise exception 'minecraft_uuid is required';
  end if;
  if p_idempotency_key is null or p_idempotency_key = '' then
    raise exception 'idempotency_key is required';
  end if;
  if p_amount_minor is null or p_amount_minor = 0 then
    raise exception 'amount_minor must be non-zero';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'metadata must be an object';
  end if;

  select *
  into v_existing
  from public.economy_ledger el
  where el.currency_key = v_currency
    and el.idempotency_key = p_idempotency_key;

  if found then
    ledger_id := v_existing.id;
    balance_minor := v_existing.balance_after_minor;
    duplicate := true;
    return next;
    return;
  end if;

  insert into public.economy_balances (currency_key, minecraft_uuid, minecraft_username, balance_minor)
  values (v_currency, p_minecraft_uuid, nullif(p_minecraft_username, ''), 0)
  on conflict (currency_key, minecraft_uuid) do update set
    minecraft_username = coalesce(nullif(excluded.minecraft_username, ''), public.economy_balances.minecraft_username)
  returning * into v_balance;

  select *
  into v_balance
  from public.economy_balances eb
  where eb.currency_key = v_currency
    and eb.minecraft_uuid = p_minecraft_uuid
  for update;

  v_new_balance := v_balance.balance_minor + p_amount_minor;

  if v_new_balance < 0 then
    raise exception 'economy transaction would create a negative balance';
  end if;

  insert into public.economy_ledger (
    currency_key,
    minecraft_uuid,
    minecraft_username,
    amount_minor,
    balance_after_minor,
    category,
    reason,
    idempotency_key,
    source,
    source_server_id,
    source_server_group,
    external_ref_type,
    external_ref_id,
    actor_type,
    actor_id,
    metadata
  ) values (
    v_currency,
    p_minecraft_uuid,
    nullif(p_minecraft_username, ''),
    p_amount_minor,
    v_new_balance,
    v_category,
    v_reason,
    p_idempotency_key,
    'plugin',
    p_server_id,
    lower(coalesce(nullif(p_server_group, ''), null)),
    nullif(p_external_ref_type, ''),
    nullif(p_external_ref_id, ''),
    'plugin',
    p_server_id,
    v_metadata
  )
  returning id into v_ledger_id;

  update public.economy_balances eb
  set balance_minor = v_new_balance,
      minecraft_username = coalesce(nullif(p_minecraft_username, ''), eb.minecraft_username),
      last_ledger_id = v_ledger_id,
      version = eb.version + 1,
      updated_at = now()
  where eb.currency_key = v_currency
    and eb.minecraft_uuid = p_minecraft_uuid;

  ledger_id := v_ledger_id;
  balance_minor := v_new_balance;
  duplicate := false;
  return next;
end;
$$;

create or replace function public.apply_economy_batch(
  p_server_id text,
  p_server_group text,
  p_currency_key text,
  p_batch_id uuid,
  p_transactions jsonb
)
returns table(
  batch_id uuid,
  submitted_count integer,
  applied_count integer,
  duplicate_count integer,
  duplicate_batch boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_currency text := lower(coalesce(nullif(p_currency_key, ''), 'realfiction_main'));
  v_tx jsonb;
  v_count integer;
  v_inserted integer;
  v_applied integer := 0;
  v_duplicates integer := 0;
  v_result record;
begin
  if p_batch_id is null then
    raise exception 'batch_id is required';
  end if;
  if p_transactions is null or jsonb_typeof(p_transactions) <> 'array' then
    raise exception 'transactions must be a JSON array';
  end if;

  v_count := jsonb_array_length(p_transactions);
  perform public._economy_assert_policy(p_server_id, p_server_group, 'batch', 0, v_count);

  insert into public.economy_transaction_batches (
    batch_id,
    server_id,
    currency_key,
    submitted_count,
    applied_count,
    duplicate_count,
    status
  ) values (
    p_batch_id,
    p_server_id,
    v_currency,
    v_count,
    0,
    0,
    'applied'
  )
  on conflict (batch_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return query
    select
      p_batch_id,
      coalesce(etb.submitted_count, 0),
      0::integer,
      coalesce(etb.duplicate_count, 0),
      true::boolean
    from public.economy_transaction_batches etb
    where etb.batch_id = p_batch_id;
    return;
  end if;

  for v_tx in select value from jsonb_array_elements(p_transactions) loop
    perform public._economy_assert_plugin_category(lower(coalesce(nullif(v_tx->>'category', ''), '')));

    select *
    into v_result
    from public.apply_economy_transaction(
      p_server_id,
      p_server_group,
      v_currency,
      v_tx->>'minecraftUuid',
      nullif(v_tx->>'minecraftUsername', ''),
      (v_tx->>'amountMinor')::bigint,
      v_tx->>'category',
      coalesce(nullif(v_tx->>'reason', ''), v_tx->>'category'),
      v_tx->>'idempotencyKey',
      nullif(v_tx->>'externalRefType', ''),
      nullif(v_tx->>'externalRefId', ''),
      coalesce(v_tx->'metadata', '{}'::jsonb)
    );

    if coalesce(v_result.duplicate, false) then
      v_duplicates := v_duplicates + 1;
    else
      v_applied := v_applied + 1;
    end if;
  end loop;

  update public.economy_transaction_batches etb
  set applied_count = v_applied,
      duplicate_count = v_duplicates
  where etb.batch_id = p_batch_id;

  batch_id := p_batch_id;
  submitted_count := v_count;
  applied_count := v_applied;
  duplicate_count := v_duplicates;
  duplicate_batch := false;
  return next;
end;
$$;

create or replace function public.admin_adjust_economy_balance(
  p_admin_user_id uuid,
  p_currency_key text,
  p_minecraft_uuid text,
  p_minecraft_username text,
  p_amount_minor bigint,
  p_reason text,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns table(
  ledger_id uuid,
  balance_minor bigint,
  duplicate boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_currency text := lower(coalesce(nullif(p_currency_key, ''), 'realfiction_main'));
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_existing public.economy_ledger%rowtype;
  v_balance public.economy_balances%rowtype;
  v_previous bigint;
  v_new bigint;
  v_ledger uuid;
  v_admin_allowed boolean;
begin
  if p_admin_user_id is null then
    raise exception 'admin_user_id is required';
  end if;
  select exists (
    select 1
    from public.profiles p
    where p.id = p_admin_user_id
      and p.role in ('staff', 'admin', 'owner')
  )
  into v_admin_allowed;
  if not coalesce(v_admin_allowed, false) then
    raise exception 'admin role required';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'reason is required';
  end if;
  if p_idempotency_key is null or p_idempotency_key = '' then
    raise exception 'idempotency_key is required';
  end if;
  if p_amount_minor is null or p_amount_minor = 0 then
    raise exception 'amount_minor must be non-zero';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'metadata must be an object';
  end if;

  select *
  into v_existing
  from public.economy_ledger el
  where el.currency_key = v_currency
    and el.idempotency_key = p_idempotency_key;

  if found then
    ledger_id := v_existing.id;
    balance_minor := v_existing.balance_after_minor;
    duplicate := true;
    return next;
    return;
  end if;

  insert into public.economy_balances (currency_key, minecraft_uuid, minecraft_username, balance_minor)
  values (v_currency, p_minecraft_uuid, nullif(p_minecraft_username, ''), 0)
  on conflict (currency_key, minecraft_uuid) do update set
    minecraft_username = coalesce(nullif(excluded.minecraft_username, ''), public.economy_balances.minecraft_username)
  returning * into v_balance;

  select *
  into v_balance
  from public.economy_balances eb
  where eb.currency_key = v_currency
    and eb.minecraft_uuid = p_minecraft_uuid
  for update;

  v_previous := v_balance.balance_minor;
  v_new := v_previous + p_amount_minor;

  if v_new < 0 then
    raise exception 'admin adjustment would create a negative balance';
  end if;

  insert into public.economy_ledger (
    currency_key,
    minecraft_uuid,
    minecraft_username,
    amount_minor,
    balance_after_minor,
    category,
    reason,
    idempotency_key,
    source,
    actor_type,
    actor_id,
    metadata
  ) values (
    v_currency,
    p_minecraft_uuid,
    nullif(p_minecraft_username, ''),
    p_amount_minor,
    v_new,
    'admin_adjustment',
    trim(p_reason),
    p_idempotency_key,
    'admin',
    'admin',
    p_admin_user_id::text,
    v_metadata
  )
  returning id into v_ledger;

  update public.economy_balances eb
  set balance_minor = v_new,
      minecraft_username = coalesce(nullif(p_minecraft_username, ''), eb.minecraft_username),
      last_ledger_id = v_ledger,
      version = eb.version + 1,
      updated_at = now()
  where eb.currency_key = v_currency
    and eb.minecraft_uuid = p_minecraft_uuid;

  insert into public.economy_admin_audit (
    admin_user_id,
    target_minecraft_uuid,
    currency_key,
    amount_minor,
    previous_balance_minor,
    new_balance_minor,
    reason,
    ledger_id,
    metadata
  ) values (
    p_admin_user_id,
    p_minecraft_uuid,
    v_currency,
    p_amount_minor,
    v_previous,
    v_new,
    trim(p_reason),
    v_ledger,
    v_metadata
  );

  ledger_id := v_ledger;
  balance_minor := v_new;
  duplicate := false;
  return next;
end;
$$;

-- Grants --------------------------------------------------------------------

revoke all on function public._economy_assert_plugin_category(text) from public, anon, authenticated;
revoke all on function public._economy_assert_policy(text, text, text, bigint, integer) from public, anon, authenticated;

revoke all on function public.get_economy_balance(text, text) from public, anon, authenticated;
grant execute on function public.get_economy_balance(text, text) to service_role;

revoke all on function public.get_plugin_economy_balance(text, text, text, text) from public, anon, authenticated;
grant execute on function public.get_plugin_economy_balance(text, text, text, text) to service_role;

revoke all on function public.apply_economy_transaction(text, text, text, text, text, bigint, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_economy_transaction(text, text, text, text, text, bigint, text, text, text, text, text, jsonb) to service_role;

revoke all on function public.apply_economy_batch(text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_economy_batch(text, text, text, uuid, jsonb) to service_role;

revoke all on function public.admin_adjust_economy_balance(uuid, text, text, text, bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_adjust_economy_balance(uuid, text, text, text, bigint, text, text, jsonb) to service_role;
