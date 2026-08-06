-- Two closures:
--
--   A. Reconciliation must be CLAIMED, bounded, and isolated from the sweep.
--   B. A refund must be measured against what was actually COLLECTED, per tender.
--
-- WHY (A)
-- =======
-- `upgrade_reservations_needing_reconciliation` was a plain read. Two scheduled
-- Worker invocations could select the same row and both drive it, and the
-- 72-hour review sweep could move a row to needs_review while a Worker was
-- mid-flight against Stripe for it. Reconciliation also had no attempt ceiling
-- and no backoff, so a permanently unreachable session was re-fetched on every
-- five-minute tick forever.
--
-- WHY (B)
-- =======
-- An upgrade order is paid through up to THREE distinct things:
--
--   merchandise subtotal 3499   <- list value, never money that was collected
--   upgrade credit      -1299   <- an entitlement the customer already owned
--   order total          2200
--   store credit         -500   <- our own liability, collected earlier
--   Stripe               1700   <- the only externally collected money
--
-- `revoke_order` reversed entitlements but nothing reversed the 500 of store
-- credit, and `restore_upgrade_credit_after_refund` was told "this is a full
-- refund" by the webhook's own scope guess. So an order could be marked
-- refunded, hand back the upgrade credit, and still leave the customer 500
-- short — while `subtotal_cents` (3499) sat in the same row as a number nothing
-- structurally prevented a future caller from treating as refundable.
--
-- Money is now reversed per tender, each with its own ceiling, and "fully
-- refunded" is a computed fact rather than a caller's claim.

-- ===========================================================================
-- A. Reconciliation claims
-- ===========================================================================

alter table public.upgrade_credit_reservations
  add column if not exists reconciliation_attempts integer not null default 0,
  add column if not exists next_reconciliation_at timestamptz,
  add column if not exists reconciliation_lease_until timestamptz,
  add column if not exists reconciliation_worker text,
  add column if not exists last_reconciliation_outcome text;

create index if not exists upgrade_reservations_reconcile_idx
on public.upgrade_credit_reservations(next_reconciliation_at, reconciliation_lease_until)
where state = 'reserved';

/**
 * Claims a bounded batch of reservations for provider reconciliation.
 *
 * `for update ... skip locked` plus a time-boxed lease is what makes two
 * concurrent scheduled Workers safe: the second one skips locked rows inside the
 * transaction, and sees a live lease afterwards.
 *
 * A crashed Worker costs nothing — the lease simply expires and the row becomes
 * claimable again. Nothing is released, cancelled, or fulfilled by expiry alone.
 */
create or replace function public.claim_upgrade_reconciliations(
  p_worker text,
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns table(
  reservation_id uuid,
  order_id uuid,
  provider_session_id text,
  requested_cancel boolean,
  expected_amount_cents bigint,
  expected_currency text,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  with due as (
    select r.id
    from public.upgrade_credit_reservations r
    -- (aliased `r` so `for update of r` locks only the reservation rows)
    join public.orders o on o.id = r.order_id
    left join lateral public.checkout_attempt_for_order(r.order_id) a on true
    where r.state = 'reserved'
      and o.status = 'pending'
      and a.stripe_session_id is not null
      -- Due: the hold aged out, or a cancellation is waiting on a verdict.
      and (r.expires_at <= now() or o.cancellation_requested_at is not null)
      -- Backoff honoured.
      and coalesce(r.next_reconciliation_at, '-infinity'::timestamptz) <= now()
      -- Not already leased by another Worker.
      and coalesce(r.reconciliation_lease_until, '-infinity'::timestamptz) <= now()
    order by o.cancellation_requested_at nulls last, r.expires_at
    -- Hard ceiling: a five-minute tick may never turn into a full-table scan.
    limit greatest(1, least(coalesce(p_limit, 10), 100))
    for update of r skip locked
  ),
  claimed as (
    update public.upgrade_credit_reservations r
    set reconciliation_lease_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900))),
        reconciliation_worker = left(coalesce(p_worker, 'unknown'), 120),
        reconciliation_attempts = r.reconciliation_attempts + 1
    from due
    where r.id = due.id
    returning r.id
  )
  select array_agg(claimed.id) into v_ids from claimed;

  return query
  select
    r.id,
    r.order_id,
    a.stripe_session_id,
    o.cancellation_requested_at is not null,
    coalesce(o.payment_due_cents, o.total_cents)::bigint,
    coalesce(o.currency, 'USD'),
    r.reconciliation_attempts
  from public.upgrade_credit_reservations r
  join public.orders o on o.id = r.order_id
  left join lateral public.checkout_attempt_for_order(r.order_id) a on true
  where r.id = any(coalesce(v_ids, '{}'::uuid[]));
end;
$$;

revoke all on function public.claim_upgrade_reconciliations(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_upgrade_reconciliations(text, integer, integer) to service_role;

/**
 * Ends a claim. Clears the lease so the row is claimable again, and applies
 * bounded exponential backoff on a retryable outcome.
 *
 * After `p_max_attempts` unresolved passes the reservation goes to a HUMAN, not
 * to released. An unreachable provider is never evidence of non-payment.
 */
create or replace function public.finish_upgrade_reconciliation(
  p_reservation_id uuid,
  p_outcome text,
  p_retry boolean default true,
  p_max_attempts integer default 10
)
returns table(outcome text, escalated boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.upgrade_credit_reservations%rowtype;
  v_backoff integer;
  v_escalated boolean := false;
begin
  select * into v_res from public.upgrade_credit_reservations where id = p_reservation_id;

  if not found then
    outcome := 'reservation_not_found'; escalated := false;
    return next; return;
  end if;

  -- Resolved (consumed/released/invalidated/needs_review): just drop the lease.
  if v_res.state <> 'reserved' or not p_retry then
    update public.upgrade_credit_reservations
    set reconciliation_lease_until = null,
        reconciliation_worker = null,
        next_reconciliation_at = null,
        last_reconciliation_outcome = left(coalesce(p_outcome, 'unknown'), 120)
    where id = p_reservation_id;

    outcome := 'closed'; escalated := false;
    return next; return;
  end if;

  if v_res.reconciliation_attempts >= greatest(1, coalesce(p_max_attempts, 10)) then
    update public.upgrade_credit_reservations
    set state = 'needs_review',
        released_reason = 'reconciliation_attempts_exhausted',
        reconciliation_lease_until = null,
        reconciliation_worker = null,
        last_reconciliation_outcome = left(coalesce(p_outcome, 'unknown'), 120)
    where id = p_reservation_id;

    outcome := 'escalated_to_review'; escalated := true;
    return next; return;
  end if;

  -- 1, 2, 4, 8 ... minutes, capped at one hour.
  v_backoff := least(3600, 60 * power(2, least(v_res.reconciliation_attempts, 6))::integer);

  update public.upgrade_credit_reservations
  set reconciliation_lease_until = null,
      reconciliation_worker = null,
      next_reconciliation_at = now() + make_interval(secs => v_backoff),
      last_reconciliation_outcome = left(coalesce(p_outcome, 'unknown'), 120)
  where id = p_reservation_id;

  outcome := 'retry_scheduled'; escalated := false;
  return next;
end;
$$;

revoke all on function public.finish_upgrade_reconciliation(uuid, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.finish_upgrade_reconciliation(uuid, text, boolean, integer) to service_role;

-- The review sweep must not touch a row a Worker is actively reconciling: it
-- would move the row to needs_review under the Worker's feet and the Worker's
-- own verdict would then be applied to a row that had already been escalated.
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
      -- Isolation: never act on a leased row.
      and coalesce(r.reconciliation_lease_until, '-infinity'::timestamptz) <= now()
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
      e.order_status = 'cancelled'
      or (e.stripe_session_id is null and e.closed_at is not null)
    );

  get diagnostics v_released = row_count;

  update public.upgrade_credit_reservations r
  set state = 'needs_review', released_reason = 'unresolved_provider_state'
  from public.orders o
  where o.id = r.order_id
    and r.state = 'reserved'
    and r.expires_at <= now() - interval '72 hours'
    and o.status = 'pending'
    and coalesce(r.reconciliation_lease_until, '-infinity'::timestamptz) <= now();

  get diagnostics v_review = row_count;

  return v_released + v_review;
end;
$$;

revoke all on function public.expire_stale_upgrade_reservations() from public, anon, authenticated;
grant execute on function public.expire_stale_upgrade_reservations() to service_role;

/**
 * Applies an authoritative provider verdict. Adds the one verdict the previous
 * version folded into "unknown": `mismatch`.
 *
 * A mismatch is not uncertainty — it is a CONTRADICTION between Stripe's record
 * and ours (wrong order, wrong session, wrong amount, wrong currency, wrong
 * environment). Retrying cannot resolve it and time cannot either, so the
 * reservation is parked for a human immediately, with a high-priority review
 * naming the session. Nothing is released and nothing is fulfilled.
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
    -- Already consumed/released/invalidated: reconciliation is a no-op, which is
    -- exactly what makes it safe to race with a webhook.
    outcome := 'already_' || v_res.state; released := false;
    return next; return;
  end if;

  if p_provider_status in ('paid', 'complete', 'succeeded') then
    v_outcome := 'held_payment_succeeded';

  elsif p_provider_status in ('async_pending', 'processing', 'unpaid_open', 'open') then
    v_outcome := 'held_payment_pending';

  elsif p_provider_status in ('expired_unpaid', 'payment_failed') then
    perform public.mark_order_unpaid_closed(v_res.order_id, 'reconciled_' || p_provider_status);
    perform public.release_store_credit_for_order(v_res.order_id);

    update public.upgrade_credit_reservations
    set state = 'released', released_at = now(),
        released_reason = 'reconciled_' || p_provider_status
    where id = p_reservation_id and state = 'reserved';

    v_outcome := 'released_' || p_provider_status;
    v_released := true;

  elsif p_provider_status = 'mismatch' then
    update public.upgrade_credit_reservations
    set state = 'needs_review',
        released_reason = 'provider_mismatch',
        reconciliation_lease_until = null,
        reconciliation_worker = null
    where id = p_reservation_id and state = 'reserved';

    insert into public.payment_reviews (
      provider, provider_event_id, event_type, order_id, reason, detail
    )
    values (
      'stripe',
      'reconciliation_mismatch:' || p_reservation_id::text,
      'upgrade_reconciliation_mismatch',
      v_res.order_id,
      'provider_record_contradicts_order',
      jsonb_build_object(
        'priority', 'high',
        'upgrade_reservation_id', p_reservation_id,
        'provider_session_id', p_provider_session_id,
        'note', 'Stripe''s record of this session does not agree with the order. Nothing was fulfilled, nothing was released.'
      )
    )
    on conflict (provider, provider_event_id) do nothing;

    v_outcome := 'needs_review_mismatch';

  else
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

-- ===========================================================================
-- B. Refund economics, per tender
-- ===========================================================================

/**
 * Append-only record of value actually reversed for an order, split by tender.
 *
 * Idempotent on the provider's refund id: Stripe emits several events per Refund
 * (`charge.refunded`, `refund.created`, `refund.updated`), and every one of them
 * must add up to exactly one reversal.
 */
create table if not exists public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null default 'stripe',
  provider_refund_id text,
  external_refund_cents bigint not null default 0 check (external_refund_cents >= 0),
  store_credit_restored_cents bigint not null default 0 check (store_credit_restored_cents >= 0),
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

create unique index if not exists order_refunds_provider_refund_idx
on public.order_refunds(provider, provider_refund_id)
where provider_refund_id is not null;

create index if not exists order_refunds_order_idx on public.order_refunds(order_id);

alter table public.order_refunds enable row level security;
-- No policies: service-role only.

/**
 * The complete refund position of an order.
 *
 * Ceilings come from what was COLLECTED, per tender:
 *   external      = payment_due_cents            (money Stripe actually took)
 *   store credit  = store_credit_applied_cents   (our own liability, spent)
 *
 * `subtotal_cents` (merchandise list value) and `discount_cents` (the upgrade
 * credit) are reported for presentation and deliberately bound NOTHING. The
 * upgrade credit was never money; refunding it as money would pay the customer
 * for an entitlement they still hold.
 */
create or replace function public.order_refund_state(p_order_id uuid)
returns table(
  merchandise_subtotal_cents bigint,
  upgrade_discount_cents bigint,
  order_total_cents bigint,
  external_paid_cents bigint,
  store_credit_paid_cents bigint,
  external_refunded_cents bigint,
  store_credit_restored_cents bigint,
  external_remaining_cents bigint,
  store_credit_remaining_cents bigint,
  economic_refunded_cents bigint,
  is_full_economic_refund boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(o.subtotal_cents, 0)::bigint,
    coalesce(o.discount_cents, 0)::bigint,
    coalesce(o.total_cents, 0)::bigint,
    greatest(0, coalesce(o.payment_due_cents, o.total_cents, 0))::bigint,
    greatest(0, coalesce(o.store_credit_applied_cents, 0))::bigint,
    coalesce(f.ext, 0)::bigint,
    coalesce(f.sc, 0)::bigint,
    greatest(0, greatest(0, coalesce(o.payment_due_cents, o.total_cents, 0)) - coalesce(f.ext, 0))::bigint,
    greatest(0, greatest(0, coalesce(o.store_credit_applied_cents, 0)) - coalesce(f.sc, 0))::bigint,
    (coalesce(f.ext, 0) + coalesce(f.sc, 0))::bigint,
    -- BOTH tenders must be whole. A 1700 Stripe refund with 500 of store credit
    -- still unrestored is NOT a full economic refund.
    (coalesce(f.ext, 0) >= greatest(0, coalesce(o.payment_due_cents, o.total_cents, 0))
     and coalesce(f.sc, 0) >= greatest(0, coalesce(o.store_credit_applied_cents, 0)))
  from public.orders o
  left join lateral (
    select sum(r.external_refund_cents) as ext, sum(r.store_credit_restored_cents) as sc
    from public.order_refunds r where r.order_id = o.id
  ) f on true
  where o.id = p_order_id
$$;

revoke all on function public.order_refund_state(uuid) from public, anon, authenticated;
grant execute on function public.order_refund_state(uuid) to service_role;

/** Convenience predicate for the order trigger. */
create or replace function public.order_is_fully_economically_refunded(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.is_full_economic_refund from public.order_refund_state(p_order_id) s), false)
$$;

revoke all on function public.order_is_fully_economically_refunded(uuid) from public, anon, authenticated;
grant execute on function public.order_is_fully_economically_refunded(uuid) to service_role;

/**
 * Records one reversal, per tender, with hard ceilings.
 *
 * FAILS CLOSED and records nothing on: an unknown order, a negative or
 * non-finite amount, a currency that is not the order's, or an amount larger
 * than the external payment. Those are not clamped silently — a refund bigger
 * than we ever collected means our model of the order disagrees with Stripe's,
 * and quietly recording the smaller number would hide that.
 *
 * Store credit is restored only once the EXTERNAL money is fully back. A partial
 * refund therefore never touches store credit: which tender a partial reversal
 * came out of is a human decision, and partial refunds already route to review.
 */
create or replace function public.record_order_refund(
  p_order_id uuid,
  p_provider_refund_id text,
  p_external_refund_cents bigint,
  p_currency text default 'USD',
  p_restore_store_credit boolean default true
)
returns table(recorded boolean, outcome text, external_applied_cents bigint, store_credit_applied_cents bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_state record;
  v_ext bigint;
  v_sc bigint := 0;
begin
  select * into v_order from public.orders where id = p_order_id for update;

  if not found then
    recorded := false; outcome := 'order_not_found';
    external_applied_cents := 0; store_credit_applied_cents := 0;
    return next; return;
  end if;

  if p_external_refund_cents is null or p_external_refund_cents < 0 then
    recorded := false; outcome := 'negative_or_missing_amount';
    external_applied_cents := 0; store_credit_applied_cents := 0;
    return next; return;
  end if;

  if upper(coalesce(p_currency, 'USD')) <> upper(coalesce(v_order.currency, 'USD')) then
    recorded := false; outcome := 'currency_mismatch';
    external_applied_cents := 0; store_credit_applied_cents := 0;
    return next; return;
  end if;

  -- Idempotent replay of the same Stripe Refund object.
  if p_provider_refund_id is not null and p_provider_refund_id <> ''
     and exists (
       select 1 from public.order_refunds
       where provider = 'stripe' and provider_refund_id = p_provider_refund_id
     ) then
    recorded := false; outcome := 'duplicate';
    external_applied_cents := 0; store_credit_applied_cents := 0;
    return next; return;
  end if;

  select * into v_state from public.order_refund_state(p_order_id) s;

  -- CEILING. Never clamp an over-refund into silence.
  if p_external_refund_cents > v_state.external_remaining_cents then
    recorded := false; outcome := 'exceeds_external_payment';
    external_applied_cents := 0; store_credit_applied_cents := 0;
    return next; return;
  end if;

  v_ext := p_external_refund_cents;

  if coalesce(p_restore_store_credit, true)
     and v_order.user_id is not null
     and (v_state.external_refunded_cents + v_ext) >= v_state.external_paid_cents
     and v_state.store_credit_remaining_cents > 0 then
    v_sc := v_state.store_credit_remaining_cents;

    insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
    values (
      v_order.user_id, v_sc, 'refund', p_order_id::text,
      'store_credit_refund:' || p_order_id::text,
      'Store credit returned after a full refund'
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing;

    -- The ledger row already existed (a prior restoration), so nothing was
    -- returned by THIS call and the reversal must not be double-counted.
    if not found then
      v_sc := 0;
    end if;
  end if;

  insert into public.order_refunds (
    order_id, provider, provider_refund_id, external_refund_cents,
    store_credit_restored_cents, currency
  )
  values (
    p_order_id, 'stripe', nullif(p_provider_refund_id, ''), v_ext, v_sc,
    upper(coalesce(p_currency, 'USD'))
  );

  recorded := true; outcome := 'recorded';
  external_applied_cents := v_ext; store_credit_applied_cents := v_sc;
  return next;
end;
$$;

revoke all on function public.record_order_refund(uuid, text, bigint, text, boolean) from public, anon, authenticated;
grant execute on function public.record_order_refund(uuid, text, bigint, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Wire the measured position into revocation and the order trigger
-- ---------------------------------------------------------------------------

/**
 * Unchanged contract, one addition: the reversal is RECORDED per tender inside
 * the same transaction as the revocation, BEFORE `revoke_order` flips the status
 * — so the trigger that follows reads a complete economic position rather than
 * trusting the caller's `p_is_full_refund` guess.
 *
 * Chargebacks record the external reversal but never restore store credit: the
 * bank pulled the card money, and whether our own liability should also be
 * handed back is an owner decision.
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

  if coalesce(p_refunded_cents, 0) > 0 then
    perform public.record_order_refund(
      p_order_id,
      nullif(p_refund_id, ''),
      p_refunded_cents,
      coalesce(p_currency, 'USD'),
      p_mode = 'refund'
    );
  end if;

  perform public.revoke_order(p_order_id, p_mode, p_reason);

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

-- The trigger no longer assumes a status change to 'refunded' means the money
-- is fully back. It asks.
create or replace function public.close_checkout_attempt_on_terminal_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('paid', 'fulfilled', 'cancelled', 'refunded', 'chargeback')
     and old.status is distinct from new.status then
    update public.checkout_attempts
    set closed_at = now(),
        closed_reason = coalesce(public.checkout_attempts.closed_reason, 'order_' || new.status::text)
    where public.checkout_attempts.order_id = new.id
      and public.checkout_attempts.closed_at is null;
  end if;

  if new.status = 'cancelled' and old.status is distinct from new.status then
    if public.order_has_provider_session(new.id) then
      null;
    else
      perform public.release_upgrade_credit(new.id, 'order_cancelled_no_session');
    end if;
  end if;

  -- Upgrade eligibility comes back only when the WHOLE economic value was
  -- reversed through the correct tenders. A 1700 Stripe refund with 500 of
  -- store credit outstanding routes to review instead.
  if new.status = 'refunded' and old.status is distinct from new.status then
    perform public.restore_upgrade_credit_after_refund(
      new.id, public.order_is_fully_economically_refunded(new.id), false
    );
  end if;

  if new.status = 'chargeback' and old.status is distinct from new.status then
    perform public.restore_upgrade_credit_after_refund(new.id, false, true);
  end if;

  if new.status in ('refunded', 'chargeback') and old.status is distinct from new.status then
    perform public.flag_source_refund_dependency(
      new.id, 'order_status_' || new.id::text, new.status::text
    );
  end if;

  return new;
end;
$$;

drop trigger if exists orders_close_checkout_attempt on public.orders;
create trigger orders_close_checkout_attempt
after update of status on public.orders
for each row
execute function public.close_checkout_attempt_on_terminal_order();

-- ---------------------------------------------------------------------------
-- Source-refund dependency: record the dependent LINEAGE, not just an order id
-- ---------------------------------------------------------------------------
/**
 * Adds the dependent entitlement ids to the review record. Without them a human
 * has to reconstruct which grants the reversed purchase is propping up, and the
 * INCLUDED entitlement (RealVIP granted by RealSupporter) is the easiest one to
 * miss.
 */
create or replace function public.flag_source_refund_dependency(
  p_source_order_id uuid,
  p_event_id text,
  p_kind text default 'refund'
)
returns table(flagged boolean, upgraded_order_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.upgrade_credit_reservations%rowtype;
  v_lineage jsonb;
begin
  select * into v_res
  from public.upgrade_credit_reservations
  where source_order_id = p_source_order_id and state = 'consumed'
  limit 1;

  if not found then
    flagged := false; upgraded_order_id := null;
    return next; return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'entitlement_id', e.id,
           'entitlement_key', e.entitlement_key,
           'status', e.status,
           'source', coalesce(e.metadata->>'source', 'order')
         )), '[]'::jsonb)
  into v_lineage
  from public.entitlements e
  join public.order_items oi on oi.id = e.order_item_id
  where oi.order_id = v_res.order_id;

  insert into public.payment_reviews (
    provider, provider_event_id, event_type, order_id, reason, detail
  )
  values (
    'stripe',
    p_event_id,
    'upgrade_source_' || p_kind,
    v_res.order_id,
    'upgrade_source_' || p_kind || '_dependency',
    jsonb_build_object(
      'priority', 'high',
      'source_order_id', p_source_order_id,
      'source_order_item_id', v_res.source_order_item_id,
      'upgrade_reservation_id', v_res.id,
      'upgraded_order_id', v_res.order_id,
      'dependent_entitlement_key', 'product:' || v_res.to_slug,
      'dependent_entitlements', v_lineage,
      'credit_cents', v_res.credit_cents,
      'note', 'Source purchase reversed after its upgrade credit was consumed. The dependent rank is still active and needs a decision.'
    )
  )
  on conflict (provider, provider_event_id) do nothing;

  update public.upgrade_credit_reservations
  set state = 'needs_review', released_reason = 'source_' || p_kind
  where id = v_res.id;

  flagged := true; upgraded_order_id := v_res.order_id;
  return next;
end;
$$;

revoke all on function public.flag_source_refund_dependency(uuid, text, text) from public, anon, authenticated;
grant execute on function public.flag_source_refund_dependency(uuid, text, text) to service_role;

-- ===========================================================================
-- C. Close the storefront/API gap on gift cards
-- ===========================================================================
-- FOUND BY THE ROLLOUT HARNESS, not by reading the code.
--
-- The storefront presents gift cards as a single coming-soon card, and the new
-- SKUs were gated inactive — but the nine seeded gift-card SKUs were left
-- `active = true`. `resolveCheckoutLines` resolves any active product in an
-- allowed category, so `POST /api/store/checkout` with `{"productId":
-- "gift-card-25"}` would have sold one. A storefront that says "coming soon"
-- while the API sells the thing is the worst version of this to discover in
-- production.
--
-- Nothing is deleted: the SKUs, their prices, and every issued gift card and
-- ledger entry are untouched. This is the same availability gate the permanent
-- ranks are behind, and reversing it is one UPDATE (see the enablement runbook).
update public.products
set active = false, updated_at = now()
where category = 'gift_cards' and active;

-- ===========================================================================
-- D. Privilege hardening
-- ===========================================================================
-- FOUND BY THE SECURITY SWEEP, not by reading the code.
--
-- Supabase GRANTS table privileges to anon/authenticated by default and relies
-- on each migration to revoke what should not be reachable. Every other store
-- table follows that convention; the three tables added by the upgrade work did
-- not. Row-level security with no policies already denies these roles, so this
-- is defence in depth rather than an open door — but "one mistake away" is not
-- where financial reservations should sit.
revoke all on table public.upgrade_credit_reservations from public, anon, authenticated;
revoke all on table public.upgrade_reconciliations from public, anon, authenticated;
revoke all on table public.order_refunds from public, anon, authenticated;
grant all on table public.upgrade_credit_reservations to service_role;
grant all on table public.upgrade_reconciliations to service_role;
grant all on table public.order_refunds to service_role;

-- A trigger function cannot be usefully invoked over PostgREST, but it was the
-- one function in this area still carrying the default grant.
revoke all on function public.close_checkout_attempt_on_terminal_order() from public, anon, authenticated;

-- `get_store_credit_balance` is SECURITY DEFINER with no fixed search_path — the
-- last one in the schema. A definer function without a pinned search_path can be
-- pointed at attacker-controlled objects by a caller who can create a schema.
-- Re-declared here unchanged apart from that pin.
-- Body and return shape are IDENTICAL to 202605290028; only the search_path pin
-- is added, so no caller sees a different result.
create or replace function public.get_store_credit_balance(
  p_user_id uuid
) returns table (
  balance_cents bigint,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(delta_cents), 0)::bigint as balance_cents,
    max(created_at) as updated_at
  from public.store_credit_ledger
  where user_id = p_user_id;
$$;

revoke all on function public.get_store_credit_balance(uuid) from public, anon, authenticated;
grant execute on function public.get_store_credit_balance(uuid) to service_role;
