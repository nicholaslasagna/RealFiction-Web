-- Refund / chargeback revocation.
--
-- Service-role only. Idempotent: re-running for an already-revoked order is a
-- no-op. History is preserved — entitlements transition status (they are not
-- deleted) and compensating "revoke" rewards are queued for RealCore to undo
-- LuckPerms/cosmetic grants. Undelivered grant rewards are cancelled so a
-- refunded purchase is never delivered.

create or replace function public.revoke_order(
  p_order_id uuid,
  p_mode text,
  p_reason text default null
)
returns table(order_id uuid, revoked_entitlements integer, cancelled_rewards integer, queued_revokes integer, already_done boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_order_status public.order_status;
  v_entitlement_status public.entitlement_status;
  v_was_fulfilled boolean;
  v_reason text;
  v_revoked integer := 0;
  v_cancelled integer := 0;
  v_queued integer := 0;
  v_rows integer := 0;
begin
  if p_mode not in ('refund', 'chargeback') then
    raise exception 'Unsupported revoke mode %', p_mode;
  end if;

  v_order_status := case when p_mode = 'chargeback' then 'chargeback' else 'refunded' end::public.order_status;
  v_entitlement_status := case when p_mode = 'chargeback' then 'revoked' else 'refunded' end::public.entitlement_status;
  v_reason := coalesce(nullif(p_reason, ''), case when p_mode = 'chargeback' then 'Payment chargeback' else 'Payment refunded' end);

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  -- Idempotent: already in a terminal revoked state.
  if v_order.status in ('refunded', 'chargeback') then
    order_id := p_order_id;
    revoked_entitlements := 0;
    cancelled_rewards := 0;
    queued_revokes := 0;
    already_done := true;
    return next;
    return;
  end if;

  v_was_fulfilled := v_order.status = 'fulfilled';

  update public.orders
  set status = v_order_status
  where id = p_order_id;

  for v_item in
    select
      oi.id as order_item_id,
      oi.quantity,
      p.id as product_id,
      p.slug,
      p.category,
      p.fulfillment_type,
      p.metadata
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id
  loop
    -- Preserve history: transition active/expired entitlements rather than delete.
    update public.entitlements
    set status = v_entitlement_status,
        revoked_at = now()
    where order_item_id = v_item.order_item_id
      and status in ('active', 'expired');

    get diagnostics v_rows = row_count;
    v_revoked := v_revoked + v_rows;

    -- Stop undelivered grants from ever reaching a server.
    update public.reward_queue
    set status = 'cancelled',
        failure_reason = v_reason
    where source = 'store'
      and source_id = v_item.order_item_id
      and status = 'pending';

    get diagnostics v_rows = row_count;
    v_cancelled := v_cancelled + v_rows;

    -- Queue a compensating revoke for grants that may already be live. Gift
    -- cards (consumable) are store-credit clawback, not a reward, so skip them.
    if v_was_fulfilled and v_item.fulfillment_type <> 'consumable' then
      insert into public.reward_queue (
        user_id, minecraft_uuid, minecraft_username,
        source, source_id, reward_key, payload, idempotency_key, status, available_at
      )
      values (
        v_order.user_id, v_order.minecraft_uuid,
        coalesce(v_order.gifted_to_minecraft_username, v_order.minecraft_username),
        'admin', v_item.order_item_id, 'revoke.' || v_item.slug,
        jsonb_build_object(
          'action', 'revoke',
          'order_id', p_order_id,
          'order_item_id', v_item.order_item_id,
          'product_id', v_item.product_id,
          'product_slug', v_item.slug,
          'category', v_item.category,
          'entitlement_key', 'product:' || v_item.slug,
          'reason', v_reason,
          'mode', p_mode,
          'metadata', v_item.metadata,
          'safe_reward', true
        ),
        'revoke:order_item:' || v_item.order_item_id::text,
        'pending', now()
      )
      on conflict (idempotency_key) do nothing;

      get diagnostics v_rows = row_count;
      v_queued := v_queued + v_rows;
    end if;
  end loop;

  insert into public.audit_logs (actor_type, action, target_table, target_id, metadata)
  values (
    'system',
    'order.' || p_mode,
    'orders',
    p_order_id,
    jsonb_build_object(
      'reason', v_reason,
      'revoked_entitlements', v_revoked,
      'cancelled_rewards', v_cancelled,
      'queued_revokes', v_queued
    )
  );

  order_id := p_order_id;
  revoked_entitlements := v_revoked;
  cancelled_rewards := v_cancelled;
  queued_revokes := v_queued;
  already_done := false;
  return next;
end;
$$;

revoke all on function public.revoke_order(uuid, text, text) from public;
revoke all on function public.revoke_order(uuid, text, text) from anon;
revoke all on function public.revoke_order(uuid, text, text) from authenticated;
grant execute on function public.revoke_order(uuid, text, text) to service_role;
