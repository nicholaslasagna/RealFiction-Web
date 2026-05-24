-- Fix apply_economy_batch ambiguity from migration 018.
--
-- Additive function-only migration. Does not modify tables, migrations 014-018,
-- RealCore, routes, reward delivery, or stat ingestion.

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
  on conflict on constraint economy_transaction_batches_pkey do nothing;

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

revoke all on function public.apply_economy_batch(text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_economy_batch(text, text, text, uuid, jsonb) to service_role;
