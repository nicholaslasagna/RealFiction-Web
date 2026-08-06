-- Fix: fully store-credit-funded checkout could never complete.
--
-- complete_store_credit_only_order (migration 202605300031) inserts the spend
-- row with:
--
--     on conflict (idempotency_key) do nothing
--
-- but store_credit_ledger's unique index is PARTIAL:
--
--     create unique index store_credit_ledger_idem_key
--       on public.store_credit_ledger(idempotency_key)
--       where idempotency_key is not null;
--
-- Postgres cannot infer a partial unique index from a bare ON CONFLICT target,
-- so the statement raises "there is no unique or exclusion constraint matching
-- the ON CONFLICT specification" — every time, for every credit-only order. The
-- checkout route catches it and shows "Payments are unavailable right now", so
-- the failure looked like a payments outage rather than a broken code path.
--
-- The fix is to supply the index predicate so the inference matches. Behaviour
-- is otherwise identical; the function is re-created verbatim apart from that
-- clause.

create or replace function public.complete_store_credit_only_order(p_order_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_available bigint;
begin
  -- Serialises concurrent completions for one buyer, so two in-flight requests
  -- cannot both pass the balance check.
  perform pg_advisory_xact_lock(hashtext('storecredit:' || p_user_id::text));

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return false;
  end if;
  if v_order.user_id is distinct from p_user_id then
    return false;
  end if;
  -- Idempotent success if already processed.
  if v_order.status in ('paid', 'fulfilled') then
    return true;
  end if;
  if v_order.status <> 'pending' then
    return false;
  end if;

  select coalesce(sum(delta_cents), 0) into v_available
  from public.store_credit_ledger
  where user_id = p_user_id;

  -- Fails closed: no ledger write, no order mutation, no entitlement.
  if v_available < v_order.total_cents then
    return false;
  end if;

  insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
  values (p_user_id, -v_order.total_cents, 'store_purchase_spend', p_order_id::text,
          'store_credit_spend:' || p_order_id::text, 'Store credit checkout')
  -- The predicate is required: the unique index is partial.
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  update public.orders
  set store_credit_applied_cents = v_order.total_cents,
      payment_due_cents = 0,
      provider = 'gift_card',
      provider_payment_id = 'store_credit',
      paid_at = coalesce(paid_at, now())
  where id = p_order_id;

  -- The same transactional fulfilment path a Stripe order uses.
  perform public.fulfill_paid_order(p_order_id);
  perform public.issue_gift_cards_for_order(p_order_id);

  return true;
end;
$$;

revoke all on function public.complete_store_credit_only_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_store_credit_only_order(uuid, uuid) to service_role;
