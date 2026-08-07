-- Generic reconciliation for pending Stripe Checkout orders.
--
-- THE FAILURE THIS RECOVERS
-- =========================
-- Stripe collects the money and the success webhook is lost. Not delayed —
-- lost: Stripe retries for a while and gives up, and if every attempt hit a bad
-- deploy, a rotated signing secret, or a Cloudflare incident, nothing on our
-- side ever hears about it. The customer is charged, the order sits pending
-- forever, and no rank, gift card, or email is ever produced.
--
-- Protecting the order from bad automatic cancellation (which the existing
-- rules already do) is only half the job. This is the other half.
--
-- WHAT THIS IS NOT
-- ================
-- Not fulfilment. Every branch of fulfilment already exists and is idempotent;
-- this only decides WHICH order to look at, holds a lease while the application
-- asks Stripe, and records the outcome. The application calls the same shared
-- entry points the webhook calls. There is deliberately no reconciliation-only
-- fulfilment path, and nothing here is product-specific — an ordinary order, a
-- mixed store-credit order, and a gift card all reconcile through the same
-- selection and the same lease.
--
-- Postgres cannot call Stripe, so the provider verdict always arrives from the
-- application. This applies verdicts; it never invents one.

-- ---------------------------------------------------------------------------
-- 1. Lease and retry state
-- ---------------------------------------------------------------------------
-- On `orders` rather than a side table: the lease belongs to the order, and a
-- join is one more thing to get wrong in a claim query that must be atomic.
alter table public.orders
  add column if not exists reconciliation_attempts integer not null default 0,
  add column if not exists reconciliation_last_at timestamptz,
  add column if not exists reconciliation_next_at timestamptz,
  add column if not exists reconciliation_worker text,
  add column if not exists reconciliation_lease_until timestamptz,
  -- Safe categories only. NEVER a Stripe response body, an amount, or a secret.
  add column if not exists reconciliation_outcome text,
  add column if not exists reconciliation_provider_status text,
  add column if not exists reconciliation_review_required boolean not null default false,
  add column if not exists reconciliation_diagnostic text;

comment on column public.orders.reconciliation_diagnostic is
  'Safe enum-like category for operators (e.g. amount_mismatch, provider_unreachable). Never a provider payload, amount, or secret.';

create index if not exists orders_reconciliation_due_idx
on public.orders(reconciliation_next_at, reconciliation_lease_until)
where status = 'pending' and not reconciliation_review_required;

/**
 * Proposed operational defaults, in ONE reviewable place.
 *
 * They are values, not hidden constants: an operator can read them here and an
 * owner can change them without hunting through application code. The
 * application passes them explicitly so a test can use different ones.
 */
create or replace function public.reconciliation_defaults()
returns table(
  batch_size integer,
  max_batch integer,
  lease_seconds integer,
  request_timeout_ms integer,
  min_age_seconds integer,
  max_attempts integer
)
language sql
immutable
as $$
  select 10, 100, 120, 8000, 120, 10
$$;

-- ---------------------------------------------------------------------------
-- 2. Claim
-- ---------------------------------------------------------------------------
/**
 * Claims a bounded batch of pending orders for reconciliation.
 *
 * `for update ... skip locked` plus a time-boxed lease is what makes two
 * concurrent scheduled Workers safe: the second skips locked rows inside the
 * transaction and sees a live lease afterwards.
 *
 * A crashed Worker costs nothing. The lease expires and the row becomes
 * claimable again — expiry alone never releases a reservation, cancels an
 * order, or fulfils anything.
 *
 * Selection is deliberately narrow. An order with no persisted Stripe session
 * was never payable and is not our business here; an order younger than
 * `p_min_age_seconds` is still inside normal webhook delivery and reconciling
 * it would race the webhook for no benefit.
 */
create or replace function public.claim_pending_reconciliations(
  p_worker text,
  p_limit integer default 10,
  p_lease_seconds integer default 120,
  p_min_age_seconds integer default 120
)
returns table(
  order_id uuid,
  provider_session_id text,
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
  v_worker text := left(coalesce(p_worker, 'unknown'), 120);
begin
  with due as (
    select o.id
    from public.orders o
    where o.status = 'pending'
      and o.provider = 'stripe'
      -- Never selected without provider evidence to check against.
      and o.provider_session_id is not null
      -- Still inside normal webhook delivery: leave it alone.
      and o.created_at <= now() - make_interval(secs => greatest(30, coalesce(p_min_age_seconds, 120)))
      -- A human owns it now.
      and not o.reconciliation_review_required
      -- Backoff honoured.
      and coalesce(o.reconciliation_next_at, '-infinity'::timestamptz) <= now()
      -- Not leased by another Worker.
      and coalesce(o.reconciliation_lease_until, '-infinity'::timestamptz) <= now()
    order by o.reconciliation_next_at nulls first, o.created_at
    -- Hard ceiling: a five-minute tick may never become a full-table scan.
    limit greatest(1, least(coalesce(p_limit, 10), 100))
    for update of o skip locked
  ),
  claimed as (
    update public.orders o
    set reconciliation_lease_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900))),
        reconciliation_worker = v_worker,
        reconciliation_attempts = o.reconciliation_attempts + 1,
        reconciliation_last_at = now()
    from due
    where o.id = due.id
    returning o.id
  )
  select array_agg(claimed.id) into v_ids from claimed;

  return query
  select
    o.id,
    o.provider_session_id,
    coalesce(o.payment_due_cents, o.total_cents)::bigint,
    coalesce(o.currency, 'USD'),
    o.reconciliation_attempts
  from public.orders o
  where o.id = any(coalesce(v_ids, '{}'::uuid[]));
end;
$$;

revoke all on function public.claim_pending_reconciliations(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_pending_reconciliations(text, integer, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Outcomes
-- ---------------------------------------------------------------------------
/**
 * Records the result of one reconciliation attempt.
 *
 * `p_outcome` is what the APPLICATION concluded after verifying provider facts.
 * This function never decides anything about money — it schedules the next
 * attempt, escalates to review, or clears the lease.
 *
 * The three shapes:
 *   resolved  -> the order reached a terminal state elsewhere; clear the lease.
 *   retry     -> bounded exponential backoff, until the attempt ceiling.
 *   review    -> a human owns it; automatic retries stop, nothing is released.
 */
create or replace function public.finish_pending_reconciliation(
  p_order_id uuid,
  p_disposition text,
  p_outcome text,
  p_provider_status text default null,
  p_diagnostic text default null,
  p_max_attempts integer default 10
)
returns table(disposition text, next_at timestamptz, review boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_backoff integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;

  if not found then
    disposition := 'order_not_found'; next_at := null; review := false;
    return next; return;
  end if;

  if p_disposition = 'resolved' then
    update public.orders
    set reconciliation_lease_until = null,
        reconciliation_worker = null,
        reconciliation_next_at = null,
        reconciliation_outcome = left(coalesce(p_outcome, 'resolved'), 60),
        reconciliation_provider_status = left(coalesce(p_provider_status, ''), 60),
        reconciliation_diagnostic = left(coalesce(p_diagnostic, ''), 120)
    where id = p_order_id;

    disposition := 'resolved'; next_at := null; review := false;
    return next; return;
  end if;

  if p_disposition = 'review' or v_order.reconciliation_attempts >= greatest(1, coalesce(p_max_attempts, 10)) then
    -- A human owns it. Nothing is released, nothing is fulfilled, and automatic
    -- retries stop so an unresolvable contradiction is not re-fetched forever.
    update public.orders
    set reconciliation_review_required = true,
        reconciliation_lease_until = null,
        reconciliation_worker = null,
        reconciliation_next_at = null,
        reconciliation_outcome = left(coalesce(p_outcome, 'review'), 60),
        reconciliation_provider_status = left(coalesce(p_provider_status, ''), 60),
        reconciliation_diagnostic = left(coalesce(p_diagnostic, 'attempts_exhausted'), 120)
    where id = p_order_id;

    disposition := 'review'; next_at := null; review := true;
    return next; return;
  end if;

  -- 1, 2, 4, 8, 16, 32, capped at 60 minutes.
  v_backoff := least(3600, 60 * power(2, least(greatest(v_order.reconciliation_attempts - 1, 0), 6))::integer);

  update public.orders
  set reconciliation_lease_until = null,
      reconciliation_worker = null,
      reconciliation_next_at = now() + make_interval(secs => v_backoff),
      reconciliation_outcome = left(coalesce(p_outcome, 'retry'), 60),
      reconciliation_provider_status = left(coalesce(p_provider_status, ''), 60),
      reconciliation_diagnostic = left(coalesce(p_diagnostic, ''), 120)
  where id = p_order_id;

  disposition := 'retry'; next_at := now() + make_interval(secs => v_backoff); review := false;
  return next;
end;
$$;

revoke all on function public.finish_pending_reconciliation(uuid, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.finish_pending_reconciliation(uuid, text, text, text, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Provider-proven unpaid expiry
-- ---------------------------------------------------------------------------
/**
 * Cancels an order that Stripe has PROVEN expired and unpaid, and releases the
 * exact reservations it was holding.
 *
 * The caller must have established that from the retrieved session — never from
 * a local timestamp. `stripe_session_expires_at` is the expiry we CONFIGURED at
 * creation; a session can complete at any point before it, so elapsed time is
 * not evidence of anything. That distinction is the whole reason this function
 * takes a verdict rather than reading a clock.
 *
 * Idempotent: an order already cancelled releases nothing further, and
 * `release_store_credit_for_order` refuses to hand back a reservation twice.
 */
create or replace function public.cancel_reconciled_unpaid_order(
  p_order_id uuid,
  p_reason text default 'reconciled_expired_unpaid'
)
returns table(cancelled boolean, released_cents bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_released bigint := 0;
begin
  select * into v_order from public.orders where id = p_order_id for update;

  if not found or v_order.status <> 'pending' then
    -- Already terminal. Nothing to cancel and certainly nothing to release.
    cancelled := false; released_cents := 0;
    return next; return;
  end if;

  select coalesce(-delta_cents, 0) into v_released
  from public.store_credit_ledger
  where idempotency_key = 'store_credit_reserve:' || p_order_id::text
    and source = 'store_credit_reserve';

  -- Releases the ledger reserve AND the gift-origin lot allocations, both
  -- idempotently, through the existing path.
  perform public.release_store_credit_for_order(p_order_id);
  perform public.mark_order_unpaid_closed(p_order_id, p_reason);

  cancelled := true; released_cents := coalesce(v_released, 0);
  return next;
end;
$$;

revoke all on function public.cancel_reconciled_unpaid_order(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_reconciled_unpaid_order(uuid, text) to service_role;
