-- Fix admin_rollback_economy_import ambiguity from migration 020.
--
-- Additive-only function replacement. Does not alter schema, routes, RealCore,
-- Vault, rewards, or prior migrations. Rollback remains compensation-only:
-- it writes reversing ledger rows and updates the balance cache through the
-- existing RPC path, with no deletes.

create or replace function public.admin_rollback_economy_import(
  p_actor_type text,
  p_actor_id text,
  p_admin_user_id uuid,
  p_currency_key text,
  p_original_import_batch_id uuid,
  p_rollback_batch_id uuid,
  p_reason text,
  p_dry_run boolean,
  p_metadata jsonb default '{}'::jsonb
)
returns table(
  original_ledger_id uuid,
  minecraft_uuid text,
  minecraft_username text,
  previous_balance_minor bigint,
  rollback_amount_minor bigint,
  new_balance_minor bigint,
  rollback_ledger_id uuid,
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
  v_original public.economy_ledger%rowtype;
  v_existing public.economy_ledger%rowtype;
  v_balance public.economy_balances%rowtype;
  v_previous bigint;
  v_amount bigint;
  v_new_balance bigint;
  v_idempotency_key text;
  v_rollback_ledger uuid;
  v_actor_ledger_type text;
  v_metadata jsonb;
begin
  perform public._economy_assert_import_actor(v_actor_type, v_actor_id, p_admin_user_id);

  if p_original_import_batch_id is null then
    raise exception 'original_import_batch_id is required';
  end if;
  if p_rollback_batch_id is null then
    raise exception 'rollback_batch_id is required';
  end if;
  if p_original_import_batch_id = p_rollback_batch_id then
    raise exception 'rollback_batch_id must differ from original_import_batch_id';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'rollback reason is required';
  end if;
  if jsonb_typeof(v_base_metadata) <> 'object' then
    raise exception 'metadata must be an object';
  end if;

  v_actor_ledger_type := case when v_actor_type = 'admin' then 'admin' else 'migration' end;

  for v_original in
    select *
    from public.economy_ledger el
    where el.currency_key = v_currency
      and el.category = 'migration_import'
      and el.metadata->>'operation' = 'import'
      and el.metadata->>'importBatchId' = p_original_import_batch_id::text
    order by el.created_at, el.id
  loop
    v_amount := -v_original.amount_minor;
    v_idempotency_key := 'migration-rollback:' || p_rollback_batch_id::text || ':' || v_original.id::text;
    v_metadata := v_base_metadata || jsonb_build_object(
      'operation', 'rollback',
      'originalImportBatchId', p_original_import_batch_id::text,
      'rollbackBatchId', p_rollback_batch_id::text,
      'originalLedgerId', v_original.id::text,
      'actorType', v_actor_type,
      'actorId', v_actor_id,
      'adminUserId', p_admin_user_id
    );

    select coalesce(eb.balance_minor, 0)::bigint
    into v_previous
    from (select 1) s
    left join public.economy_balances eb
      on eb.currency_key = v_currency
     and eb.minecraft_uuid = v_original.minecraft_uuid;

    v_new_balance := coalesce(v_previous, 0) + v_amount;
    if v_new_balance < 0 then
      raise exception 'migration rollback would create a negative balance';
    end if;

    if coalesce(p_dry_run, true) then
      original_ledger_id := v_original.id;
      minecraft_uuid := v_original.minecraft_uuid;
      minecraft_username := v_original.minecraft_username;
      previous_balance_minor := coalesce(v_previous, 0);
      rollback_amount_minor := v_amount;
      new_balance_minor := v_new_balance;
      rollback_ledger_id := null;
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
      original_ledger_id := v_original.id;
      minecraft_uuid := v_original.minecraft_uuid;
      minecraft_username := v_original.minecraft_username;
      previous_balance_minor := null;
      rollback_amount_minor := v_existing.amount_minor;
      new_balance_minor := v_existing.balance_after_minor;
      rollback_ledger_id := v_existing.id;
      duplicate := true;
      dry_run := false;
      return next;
      continue;
    end if;

    insert into public.economy_balances (currency_key, minecraft_uuid, minecraft_username, balance_minor)
    values (v_currency, v_original.minecraft_uuid, v_original.minecraft_username, 0)
    on conflict on constraint economy_balances_pkey do update set
      minecraft_username = coalesce(nullif(excluded.minecraft_username, ''), public.economy_balances.minecraft_username);

    select *
    into v_balance
    from public.economy_balances eb
    where eb.currency_key = v_currency
      and eb.minecraft_uuid = v_original.minecraft_uuid
    for update;

    v_previous := v_balance.balance_minor;
    v_new_balance := v_previous + v_amount;
    if v_new_balance < 0 then
      raise exception 'migration rollback would create a negative balance';
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
      v_original.minecraft_uuid,
      v_original.minecraft_username,
      v_amount,
      v_new_balance,
      'migration_import',
      v_reason,
      v_idempotency_key,
      'migration',
      'economy_migration_rollback',
      p_original_import_batch_id::text,
      v_actor_ledger_type,
      v_actor_id,
      v_metadata
    )
    returning id into v_rollback_ledger;

    update public.economy_balances eb
    set balance_minor = v_new_balance,
        minecraft_username = coalesce(v_original.minecraft_username, eb.minecraft_username),
        last_ledger_id = v_rollback_ledger,
        version = eb.version + 1,
        updated_at = now()
    where eb.currency_key = v_currency
      and eb.minecraft_uuid = v_original.minecraft_uuid;

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
      v_original.minecraft_uuid,
      v_currency,
      v_amount,
      v_previous,
      v_new_balance,
      v_reason,
      v_rollback_ledger,
      v_metadata
    );

    original_ledger_id := v_original.id;
    minecraft_uuid := v_original.minecraft_uuid;
    minecraft_username := v_original.minecraft_username;
    previous_balance_minor := v_previous;
    rollback_amount_minor := v_amount;
    new_balance_minor := v_new_balance;
    rollback_ledger_id := v_rollback_ledger;
    duplicate := false;
    dry_run := false;
    return next;
  end loop;
end;
$$;

revoke all on function public.admin_rollback_economy_import(text, text, uuid, text, uuid, uuid, text, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_rollback_economy_import(text, text, uuid, text, uuid, uuid, text, boolean, jsonb)
  to service_role;
