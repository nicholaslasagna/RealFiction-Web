-- Fix admin_import_economy_balances ambiguity from migration 020.
--
-- Additive-only function replacement. Does not alter schema, routes, RealCore,
-- Vault, rewards, or prior migrations. The behavior remains the same, but the
-- economy_balances upsert now uses the primary-key constraint name instead of
-- ambiguous column references inside a RETURNS TABLE function.

create or replace function public.admin_import_economy_balances(
  p_actor_type text,
  p_actor_id text,
  p_admin_user_id uuid,
  p_currency_key text,
  p_import_batch_id uuid,
  p_reason text,
  p_dry_run boolean,
  p_entries jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns table(
  minecraft_uuid text,
  minecraft_username text,
  previous_balance_minor bigint,
  target_balance_minor bigint,
  delta_minor bigint,
  ledger_id uuid,
  duplicate boolean,
  dry_run boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_currency text := lower(coalesce(nullif(p_currency_key, ''), 'realfiction_main'));
  v_actor_type text := lower(coalesce(nullif(p_actor_type, ''), ''));
  v_actor_id text := trim(p_actor_id);
  v_reason text := trim(coalesce(p_reason, ''));
  v_base_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_entry jsonb;
  v_entry_metadata jsonb;
  v_entry_count integer;
  v_uuid text;
  v_username text;
  v_target bigint;
  v_previous bigint;
  v_delta bigint;
  v_new_balance bigint;
  v_idempotency_key text;
  v_existing public.economy_ledger%rowtype;
  v_balance public.economy_balances%rowtype;
  v_ledger uuid;
  v_actor_ledger_type text;
  v_metadata jsonb;
begin
  perform public._economy_assert_import_actor(v_actor_type, v_actor_id, p_admin_user_id);

  if p_import_batch_id is null then
    raise exception 'import_batch_id is required';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'import reason is required';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'entries must be a JSON array';
  end if;
  if jsonb_typeof(v_base_metadata) <> 'object' then
    raise exception 'metadata must be an object';
  end if;

  v_entry_count := jsonb_array_length(p_entries);
  if v_entry_count < 1 then
    raise exception 'at least one import entry is required';
  end if;
  if v_entry_count > 5000 then
    raise exception 'import entry count exceeds limit';
  end if;

  v_actor_ledger_type := case when v_actor_type = 'admin' then 'admin' else 'migration' end;

  for v_entry in select value from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(v_entry) <> 'object' then
      raise exception 'each import entry must be an object';
    end if;

    v_uuid := trim(coalesce(v_entry->>'minecraftUuid', ''));
    v_username := nullif(trim(coalesce(v_entry->>'minecraftUsername', '')), '');
    if v_uuid = '' then
      raise exception 'minecraftUuid is required';
    end if;
    if v_uuid !~ '^[A-Za-z0-9_.:-]{8,48}$' then
      raise exception 'minecraftUuid has invalid shape';
    end if;
    if not (v_entry ? 'targetBalanceMinor') then
      raise exception 'targetBalanceMinor is required';
    end if;

    v_target := (v_entry->>'targetBalanceMinor')::bigint;
    if v_target < 0 then
      raise exception 'targetBalanceMinor must be non-negative';
    end if;

    v_entry_metadata := coalesce(v_entry->'metadata', '{}'::jsonb);
    if jsonb_typeof(v_entry_metadata) <> 'object' then
      raise exception 'entry metadata must be an object';
    end if;

    v_idempotency_key := 'migration-import:' || p_import_batch_id::text || ':' || v_uuid || ':' || v_currency;
    v_metadata := v_base_metadata
      || v_entry_metadata
      || jsonb_build_object(
        'operation', 'import',
        'importBatchId', p_import_batch_id::text,
        'actorType', v_actor_type,
        'actorId', v_actor_id,
        'adminUserId', p_admin_user_id,
        'targetBalanceMinor', v_target
      );

    select coalesce(eb.balance_minor, 0)::bigint
    into v_previous
    from (select 1) s
    left join public.economy_balances eb
      on eb.currency_key = v_currency
     and eb.minecraft_uuid = v_uuid;

    v_delta := v_target - coalesce(v_previous, 0);

    if coalesce(p_dry_run, true) then
      minecraft_uuid := v_uuid;
      minecraft_username := v_username;
      previous_balance_minor := coalesce(v_previous, 0);
      target_balance_minor := v_target;
      delta_minor := v_delta;
      ledger_id := null;
      duplicate := false;
      dry_run := true;
      return next;
      continue;
    end if;

    select *
    into v_existing
    from public.economy_ledger el
    where el.currency_key = v_currency
      and el.idempotency_key = v_idempotency_key;

    if found then
      minecraft_uuid := v_uuid;
      minecraft_username := coalesce(v_existing.minecraft_username, v_username);
      previous_balance_minor := null;
      target_balance_minor := v_existing.balance_after_minor;
      delta_minor := v_existing.amount_minor;
      ledger_id := v_existing.id;
      duplicate := true;
      dry_run := false;
      return next;
      continue;
    end if;

    insert into public.economy_balances (currency_key, minecraft_uuid, minecraft_username, balance_minor)
    values (v_currency, v_uuid, v_username, 0)
    on conflict on constraint economy_balances_pkey do update set
      minecraft_username = coalesce(nullif(excluded.minecraft_username, ''), public.economy_balances.minecraft_username);

    select *
    into v_balance
    from public.economy_balances eb
    where eb.currency_key = v_currency
      and eb.minecraft_uuid = v_uuid
    for update;

    v_previous := v_balance.balance_minor;
    v_delta := v_target - v_previous;

    if v_delta = 0 then
      minecraft_uuid := v_uuid;
      minecraft_username := coalesce(v_balance.minecraft_username, v_username);
      previous_balance_minor := v_previous;
      target_balance_minor := v_target;
      delta_minor := 0;
      ledger_id := null;
      duplicate := false;
      dry_run := false;
      return next;
      continue;
    end if;

    v_new_balance := v_previous + v_delta;
    if v_new_balance < 0 then
      raise exception 'migration import would create a negative balance';
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
      external_ref_type,
      external_ref_id,
      actor_type,
      actor_id,
      metadata
    ) values (
      v_currency,
      v_uuid,
      v_username,
      v_delta,
      v_new_balance,
      'migration_import',
      v_reason,
      v_idempotency_key,
      'migration',
      'economy_migration_import',
      p_import_batch_id::text,
      v_actor_ledger_type,
      v_actor_id,
      v_metadata
    )
    returning id into v_ledger;

    update public.economy_balances eb
    set balance_minor = v_new_balance,
        minecraft_username = coalesce(v_username, eb.minecraft_username),
        last_ledger_id = v_ledger,
        version = eb.version + 1,
        updated_at = now()
    where eb.currency_key = v_currency
      and eb.minecraft_uuid = v_uuid;

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
      v_uuid,
      v_currency,
      v_delta,
      v_previous,
      v_new_balance,
      v_reason,
      v_ledger,
      v_metadata
    );

    minecraft_uuid := v_uuid;
    minecraft_username := v_username;
    previous_balance_minor := v_previous;
    target_balance_minor := v_target;
    delta_minor := v_delta;
    ledger_id := v_ledger;
    duplicate := false;
    dry_run := false;
    return next;
  end loop;
end;
$$;

revoke all on function public.admin_import_economy_balances(text, text, uuid, text, uuid, text, boolean, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_import_economy_balances(text, text, uuid, text, uuid, text, boolean, jsonb, jsonb)
  to service_role;
