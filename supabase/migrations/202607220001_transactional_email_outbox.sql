-- Transactional email outbox.
--
-- Sending is asynchronous and best-effort. CREATING THE OUTBOX ROW IS NOT.
--
-- A fully credit-funded order has no Stripe webhook to replay: if fulfilment
-- commits and a separate enqueue call then fails, the customer permanently loses
-- their confirmation with nothing to retry from. So the outbox row is written in
-- the SAME transaction as fulfilment — if it cannot be written, nothing is:
-- no credit consumed, no entitlement, no reward, no terminal status.
--
-- Once the row exists, Resend processing is fully independent: a provider outage
-- or a permanent rejection can never roll back fulfilment or restore credit.
-- No provider HTTP call happens inside any of these functions.

-- ---------------------------------------------------------------------------
-- 1. Outbox helpers (called INSIDE fulfilment transactions)
-- ---------------------------------------------------------------------------
/**
 * Idempotent order-confirmation outbox row, keyed `order_confirmation:<id>`.
 *
 * Returns false when the order has no buyer email — there is no address to send
 * to, which is not a failure and must not block fulfilment. Any real error
 * (constraint violation, table missing) propagates and rolls the caller back.
 */
create or replace function public.enqueue_order_confirmation_delivery(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select buyer_email into v_email from public.orders where id = p_order_id;

  if v_email is null or btrim(v_email) = '' then
    return false;
  end if;

  insert into public.email_deliveries (
    idempotency_key, template, recipient, order_id, params, delivery_outcome, attempts, next_attempt_at
  )
  values (
    'order_confirmation:' || p_order_id::text,
    'order_confirmation', btrim(v_email), p_order_id, '{}'::jsonb, 'pending', 0, now()
  )
  on conflict (idempotency_key) do nothing;

  return true;
end;
$$;

revoke all on function public.enqueue_order_confirmation_delivery(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_order_confirmation_delivery(uuid) to service_role;

/** Idempotent refund-confirmation outbox row, keyed on the Stripe REFUND id. */
create or replace function public.enqueue_refund_confirmation_delivery(
  p_order_id uuid,
  p_refund_id text,
  p_refunded_cents bigint,
  p_currency text,
  p_is_full_refund boolean,
  p_entitlement_status text,
  p_affected_item_name text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select buyer_email into v_email from public.orders where id = p_order_id;

  if v_email is null or btrim(v_email) = '' then
    return false;
  end if;

  insert into public.email_deliveries (
    idempotency_key, template, recipient, order_id, params, delivery_outcome, attempts, next_attempt_at
  )
  values (
    'refund_confirmation:' || p_refund_id,
    'refund_confirmation', btrim(v_email), p_order_id,
    jsonb_build_object(
      'refundedCents', p_refunded_cents,
      'currency', coalesce(p_currency, 'USD'),
      'isFullRefund', p_is_full_refund,
      'affectedItemName', p_affected_item_name,
      'entitlementStatus', p_entitlement_status
    ),
    'pending', 0, now()
  )
  on conflict (idempotency_key) do nothing;

  return true;
end;
$$;

revoke all on function public.enqueue_refund_confirmation_delivery(uuid, text, bigint, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_refund_confirmation_delivery(uuid, text, bigint, text, boolean, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Credit-only fulfilment, now including the outbox
-- ---------------------------------------------------------------------------
/**
 * One transaction: verify credit, consume it once, fulfil once, create
 * entitlements/rewards, reach terminal status (which fires the trigger that
 * closes the checkout attempt), and write the confirmation outbox row.
 *
 * If the outbox insert raises, the exception propagates and Postgres rolls the
 * whole function back — the customer keeps their credit and can retry.
 */
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
  perform pg_advisory_xact_lock(hashtext('storecredit:' || p_user_id::text));

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return false;
  end if;
  if v_order.user_id is distinct from p_user_id then
    return false;
  end if;
  if v_order.status in ('paid', 'fulfilled') then
    -- Idempotent replay: make sure the outbox row exists even if a previous
    -- attempt committed fulfilment under an older code path.
    perform public.enqueue_order_confirmation_delivery(p_order_id);
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

  perform public.fulfill_paid_order(p_order_id);
  perform public.issue_gift_cards_for_order(p_order_id);

  -- Durable outbox row, same transaction. No Resend call happens here.
  perform public.enqueue_order_confirmation_delivery(p_order_id);

  return true;
end;
$$;

revoke all on function public.complete_store_credit_only_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_store_credit_only_order(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Stripe-paid fulfilment, now including the outbox
-- ---------------------------------------------------------------------------
/**
 * One transaction for the webhook: record payment references, fulfil, and write
 * the confirmation outbox row. If any part fails the caller gets an exception
 * and must return a retryable response so Stripe redelivers — never a 2xx that
 * silently dropped the outbox operation.
 */
create or replace function public.fulfill_paid_order_with_outbox(
  p_order_id uuid,
  p_payment_intent_id text default null,
  p_charge_id text default null,
  p_receipt_url text default null
)
returns table(already_fulfilled boolean, email_queued boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fulfilled boolean;
  v_queued boolean;
begin
  update public.orders
  set provider_payment_id = coalesce(p_payment_intent_id, provider_payment_id),
      stripe_charge_id = coalesce(p_charge_id, stripe_charge_id),
      stripe_receipt_url = coalesce(p_receipt_url, stripe_receipt_url),
      paid_at = coalesce(paid_at, now())
  where id = p_order_id;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  select f.already_fulfilled into v_fulfilled from public.fulfill_paid_order(p_order_id) f;

  -- Durable outbox row, same transaction. No Resend call happens here.
  v_queued := public.enqueue_order_confirmation_delivery(p_order_id);

  already_fulfilled := coalesce(v_fulfilled, false);
  email_queued := coalesce(v_queued, false);
  return next;
end;
$$;

revoke all on function public.fulfill_paid_order_with_outbox(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.fulfill_paid_order_with_outbox(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Refund revocation + outbox, atomically
-- ---------------------------------------------------------------------------
/**
 * Claims the revocation (keyed on the Stripe refund/dispute id), revokes the
 * order, and writes the refund-confirmation outbox row — all or nothing.
 *
 * `claimed = false` means another event already handled this refund, so nothing
 * is repeated: several Stripe events for one Refund produce exactly one
 * revocation and exactly one email.
 */
create or replace function public.revoke_order_with_refund_outbox(
  p_order_id uuid,
  p_operation_key text,
  p_mode text,
  p_reason text,
  p_refund_id text,
  p_refunded_cents bigint,
  p_currency text,
  p_is_full_refund boolean,
  p_entitlement_status text,
  p_affected_item_name text default null
)
returns table(claimed boolean, email_queued boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
  v_queued boolean := false;
begin
  v_claimed := public.claim_payment_revocation(p_operation_key, p_order_id, p_mode, p_reason);

  if not v_claimed then
    claimed := false;
    email_queued := false;
    return next;
    return;
  end if;

  perform public.revoke_order(p_order_id, p_mode, p_reason);

  -- Only a settled refund produces customer mail; a chargeback conversation
  -- belongs to the bank, so callers pass a null refund id for those.
  if p_refund_id is not null and p_refund_id <> '' then
    v_queued := public.enqueue_refund_confirmation_delivery(
      p_order_id, p_refund_id, p_refunded_cents, p_currency,
      p_is_full_refund, p_entitlement_status, p_affected_item_name
    );
  end if;

  claimed := true;
  email_queued := coalesce(v_queued, false);
  return next;
end;
$$;

revoke all on function public.revoke_order_with_refund_outbox(uuid, text, text, text, text, bigint, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.revoke_order_with_refund_outbox(uuid, text, text, text, text, bigint, text, boolean, text, text) to service_role;

/**
 * Partial refunds do not revoke anything, but the customer is still told their
 * money is coming back. Outbox-only, idempotent on the refund id.
 */
create or replace function public.enqueue_partial_refund_outbox(
  p_order_id uuid,
  p_refund_id text,
  p_refunded_cents bigint,
  p_currency text,
  p_affected_item_name text default null
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.enqueue_refund_confirmation_delivery(
    p_order_id, p_refund_id, p_refunded_cents, p_currency, false, 'under_review', p_affected_item_name
  );
$$;

revoke all on function public.enqueue_partial_refund_outbox(uuid, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_partial_refund_outbox(uuid, text, bigint, text, text) to service_role;
