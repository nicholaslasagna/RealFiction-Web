-- Delayed-webhook safety: a session-backed reservation is NEVER released on a
-- timestamp, and store-credit-funded sources are temporarily ineligible.
--
-- THE BUG THIS FIXES (reproduced before fixing)
-- =============================================
-- The previous sweep released when: order pending AND a Stripe session existed
-- AND stripe_session_expires_at had passed.
--
-- That is precisely the delayed-webhook state:
--   1. credit reserved
--   2. customer completes Checkout — Stripe HAS the money
--   3. webhook delayed or retrying
--   4. our order is still 'pending' (we do not know yet)
--   5. the configured session expiry passes
--   6. the sweep releases the credit
--   7. the delayed webhook fulfils a discounted order with no reservation
--
-- `stripe_session_expires_at` is the expiry we CONFIGURED at creation. It is not
-- evidence the session went unpaid — a session can complete at any point before
-- it. Testing an order already marked 'paid' does not model this, because by
-- then the webhook has already been processed.
--
-- New rule: when a Stripe session id is persisted, automatic release requires
-- authoritative TERMINAL evidence. In this codebase that means the order
-- reached 'cancelled', which only happens when a processed
-- checkout.session.expired / async_payment_failed webhook called
-- mark_order_unpaid_closed, or an explicit cancellation ran. Elapsed time is
-- never sufficient.

create or replace function public.expire_stale_upgrade_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released integer;
  v_review integer;
begin
  -- (1) SAFE database-only releases. Each requires terminal evidence.
  with evidence as (
    select
      r.id,
      o.status as order_status,
      a.stripe_session_id,
      a.closed_at
    from public.upgrade_credit_reservations r
    join public.orders o on o.id = r.order_id
    left join public.checkout_attempt_for_order(r.order_id) a on true
    where r.state = 'reserved'
      and r.expires_at <= now()
  )
  update public.upgrade_credit_reservations r
  set state = 'released', released_at = now(),
      released_reason = case
        when e.order_status = 'cancelled' then 'order_terminally_cancelled'
        else 'no_provider_session_created'
      end
  from evidence e
  where r.id = e.id
    and (
      -- Terminal local state. Reached only via a processed expiry/failure
      -- webhook or an explicit cancel, both of which prove no payment stands.
      e.order_status = 'cancelled'

      -- OR: Stripe session creation never succeeded, so nothing was ever
      -- payable, and the attempt is closed.
      or (e.stripe_session_id is null and e.closed_at is not null)
    );

  get diagnostics v_released = row_count;

  -- (2) Everything else that is stale is UNRESOLVED, not dead. A session-backed
  -- pending order may have been paid with the webhook still in flight, so it is
  -- never auto-released — after a long horizon it goes to a human.
  update public.upgrade_credit_reservations r
  set state = 'needs_review', released_reason = 'unresolved_provider_state'
  from public.orders o
  where o.id = r.order_id
    and r.state = 'reserved'
    and r.expires_at <= now() - interval '72 hours'
    and o.status = 'pending';

  get diagnostics v_review = row_count;

  return v_released + v_review;
end;
$$;

revoke all on function public.expire_stale_upgrade_reservations() from public, anon, authenticated;
grant execute on function public.expire_stale_upgrade_reservations() to service_role;

/** Newest checkout attempt for an order. Helper so the sweep stays readable. */
create or replace function public.checkout_attempt_for_order(p_order_id uuid)
returns table(stripe_session_id text, stripe_session_expires_at timestamptz, closed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select a.stripe_session_id, a.stripe_session_expires_at, a.closed_at
  from public.checkout_attempts a
  where a.order_id = p_order_id
  order by a.created_at desc
  limit 1
$$;

revoke all on function public.checkout_attempt_for_order(uuid) from public, anon, authenticated;
grant execute on function public.checkout_attempt_for_order(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Provider reconciliation outcomes (called BY THE APPLICATION, never from SQL)
-- ---------------------------------------------------------------------------
-- Postgres cannot call Stripe. The application retrieves the authoritative
-- session state and reports it here; this function only applies the decision.
create table if not exists public.upgrade_reconciliations (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.upgrade_credit_reservations(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  provider_session_id text,
  provider_status text not null,
  outcome text not null,
  checked_at timestamptz not null default now()
);

create index if not exists upgrade_reconciliations_reservation_idx
on public.upgrade_reconciliations(reservation_id, checked_at desc);

alter table public.upgrade_reconciliations enable row level security;
-- No policies: service-role only.

/**
 * Applies an authoritative provider verdict to one reservation.
 *
 * `p_provider_status` is what Stripe actually said, retrieved server-side:
 *   paid / complete   -> HOLD. Fulfilment will consume it.
 *   async_pending     -> HOLD. The payment is still live.
 *   expired_unpaid    -> cancel the order + release, idempotently.
 *   payment_failed    -> cancel the order + release, idempotently.
 *   anything else     -> HOLD (unknown is never a reason to release).
 */
create or replace function public.apply_upgrade_reconciliation(
  p_reservation_id uuid,
  p_provider_status text,
  p_provider_session_id text default null
)
returns table(outcome text, released boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.upgrade_credit_reservations%rowtype;
  v_outcome text;
  v_released boolean := false;
begin
  select * into v_res from public.upgrade_credit_reservations where id = p_reservation_id;

  if not found then
    outcome := 'reservation_not_found'; released := false;
    return next; return;
  end if;

  if v_res.state <> 'reserved' then
    -- Already consumed/released/invalidated: reconciliation is a no-op, which
    -- is what makes it safe to race with a webhook.
    outcome := 'already_' || v_res.state; released := false;
    return next; return;
  end if;

  if p_provider_status in ('paid', 'complete', 'succeeded') then
    v_outcome := 'held_payment_succeeded';

  elsif p_provider_status in ('async_pending', 'processing', 'unpaid_open', 'open') then
    v_outcome := 'held_payment_pending';

  elsif p_provider_status in ('expired_unpaid', 'payment_failed') then
    -- Authoritative terminal failure. Cancel through the existing path so the
    -- order trigger closes the attempt and releases store credit consistently.
    perform public.mark_order_unpaid_closed(v_res.order_id, 'reconciled_' || p_provider_status);
    perform public.release_store_credit_for_order(v_res.order_id);

    update public.upgrade_credit_reservations
    set state = 'released', released_at = now(),
        released_reason = 'reconciled_' || p_provider_status
    where id = p_reservation_id and state = 'reserved';

    v_outcome := 'released_' || p_provider_status;
    v_released := true;

  else
    -- Unreachable provider, unsupported status: never release.
    v_outcome := 'held_unknown_provider_state';
  end if;

  insert into public.upgrade_reconciliations (
    reservation_id, order_id, provider_session_id, provider_status, outcome
  )
  values (p_reservation_id, v_res.order_id, p_provider_session_id, p_provider_status, v_outcome);

  outcome := v_outcome; released := v_released;
  return next;
end;
$$;

revoke all on function public.apply_upgrade_reconciliation(uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_upgrade_reconciliation(uuid, text, text) to service_role;

/** Reservations the application should reconcile against Stripe. */
create or replace function public.upgrade_reservations_needing_reconciliation(p_limit integer default 20)
returns table(reservation_id uuid, order_id uuid, provider_session_id text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.order_id, a.stripe_session_id
  from public.upgrade_credit_reservations r
  join public.orders o on o.id = r.order_id
  left join lateral public.checkout_attempt_for_order(r.order_id) a on true
  where r.state = 'reserved'
    and r.expires_at <= now()
    and o.status = 'pending'
    and a.stripe_session_id is not null
  order by r.expires_at
  limit greatest(1, p_limit)
$$;

revoke all on function public.upgrade_reservations_needing_reconciliation(integer) from public, anon, authenticated;
grant execute on function public.upgrade_reservations_needing_reconciliation(integer) to service_role;

-- ---------------------------------------------------------------------------
-- TEMPORARY policy: store-credit-funded sources are ineligible
-- ---------------------------------------------------------------------------
-- The ledger records store_credit_ledger.source (including 'manual_grant'), but
-- there is NO per-order tender allocation, so we cannot tell which ledger
-- entries funded a given order. A promotional manual_grant balance could
-- therefore be converted into a permanent cash-equivalent upgrade discount.
--
-- Until per-order tender provenance exists, only a fully externally-paid order
-- creates upgrade credit. This is deliberately stricter than the intended final
-- policy; legitimate store-credit purchases are supported once allocation is
-- auditable. No ledger provenance is deleted.
create or replace function public.eligible_upgrade_sources(
  p_user_id uuid,
  p_from_slug text
)
returns table(
  order_item_id uuid,
  order_id uuid,
  credit_cents bigint,
  purchased_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    oi.id,
    o.id,
    greatest(0, oi.total_cents)::bigint,
    coalesce(o.paid_at, o.created_at)
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.products p on p.id = oi.product_id
  where o.user_id = p_user_id
    and p.slug = p_from_slug
    and p.fulfillment_type = 'permanent'
    and o.status = 'fulfilled'
    and o.gifted_to_minecraft_username is null
    and oi.total_cents > 0
    -- TEMPORARY: no store credit may have funded this order.
    and coalesce(o.store_credit_applied_cents, 0) = 0
    -- Single-item order, so the item value is unambiguously the whole payment.
    and (select count(*) from public.order_items x where x.order_id = o.id) = 1
    -- A real, order-sourced entitlement: excludes manual grants and inherited
    -- ranks, which have no paid line at all.
    and exists (
      select 1 from public.entitlements e
      where e.order_item_id = oi.id
        and e.entitlement_key = 'product:' || p_from_slug
        and e.status = 'active'
        and coalesce(e.metadata->>'source', '') = 'order'
    )
    and not exists (
      select 1 from public.upgrade_credit_reservations r
      where r.source_order_item_id = oi.id
        and r.state in ('reserved', 'consumed', 'needs_review')
    )
$$;

revoke all on function public.eligible_upgrade_sources(uuid, text) from public, anon, authenticated;
grant execute on function public.eligible_upgrade_sources(uuid, text) to service_role;
