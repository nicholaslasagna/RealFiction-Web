-- Lease and backoff for gift-card refund reconciliation.
--
-- Objective 2 needs bounded selection with a durable lease, and the refund
-- state machine has no such columns. This adds only that: no policy changes, no
-- new states, no change to how eligibility or reversal are decided.
--
-- The recovery: Stripe created the Refund and the response (or the webhook)
-- was lost. The workflow sits in `provider_refund_pending` with the value
-- frozen or the card void — which is the SAFE side of the uncertainty — and
-- nothing finalises it until someone asks Stripe what actually happened.

-- ORDERING GUARD.
-- This migration extends `gift_card_refunds`, which 202608070002 creates. If
-- that migration has not been applied — or failed partway, which it did on
-- databases carrying the older four-column `record_order_refund` — Postgres
-- reports only "relation does not exist", which does not say what to do.
do $$
begin
  if to_regclass('public.gift_card_refunds') is null then
    raise exception
      'ABORT: 202608070002_gift_card_refunds_and_disputes.sql has not been applied successfully.'
      using hint =
        'Apply 202608070002 first. If it previously failed with "cannot change return type of existing function", it now drops the old record_order_refund signatures itself — re-run it, then re-run this one.';
  end if;
end $$;

alter table public.gift_card_refunds
  add column if not exists reconciliation_next_at timestamptz,
  add column if not exists reconciliation_lease_until timestamptz,
  add column if not exists reconciliation_worker text;

create index if not exists gift_card_refunds_reconcile_idx
on public.gift_card_refunds(reconciliation_next_at, reconciliation_lease_until)
where state = 'provider_refund_pending';

/**
 * Claims a bounded batch of refunds whose provider result is unknown.
 *
 * Same shape as pending-payment reconciliation: FOR UPDATE SKIP LOCKED plus a
 * time-boxed lease, so two Workers cannot drive the same refund and a crashed
 * one simply loses its lease. Expiry alone never finalises or unfreezes.
 */
create or replace function public.claim_pending_gift_card_refunds(
  p_worker text,
  p_limit integer default 10,
  p_lease_seconds integer default 120,
  p_min_age_seconds integer default 60
)
returns table(
  refund_id uuid,
  gift_card_id uuid,
  purchaser_order_id uuid,
  eligible_external_cents bigint,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
declare v_ids uuid[];
begin
  with due as (
    select r.id
    from public.gift_card_refunds r
    where r.state = 'provider_refund_pending'
      and r.provider_requested_at <= now() - make_interval(secs => greatest(15, coalesce(p_min_age_seconds, 60)))
      and coalesce(r.reconciliation_next_at, '-infinity'::timestamptz) <= now()
      and coalesce(r.reconciliation_lease_until, '-infinity'::timestamptz) <= now()
    order by r.provider_requested_at
    limit greatest(1, least(coalesce(p_limit, 10), 100))
    for update of r skip locked
  ),
  claimed as (
    update public.gift_card_refunds r
    set reconciliation_lease_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900))),
        reconciliation_worker = left(coalesce(p_worker, 'unknown'), 120),
        attempts = r.attempts + 1
    from due where r.id = due.id
    returning r.id
  )
  select array_agg(claimed.id) into v_ids from claimed;

  return query
  select r.id, r.gift_card_id, r.purchaser_order_id, r.eligible_external_cents, r.attempts
  from public.gift_card_refunds r
  where r.id = any(coalesce(v_ids, '{}'::uuid[]));
end;
$$;

revoke all on function public.claim_pending_gift_card_refunds(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_pending_gift_card_refunds(text, integer, integer, integer) to service_role;

/** Schedules the next attempt, or hands an exhausted refund to a human. */
create or replace function public.defer_gift_card_refund(
  p_refund_id uuid,
  p_category text,
  p_max_attempts integer default 10
)
returns table(outcome text, review boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.gift_card_refunds%rowtype;
  v_backoff integer;
begin
  select * into v_refund from public.gift_card_refunds where id = p_refund_id for update;
  if not found then
    outcome := 'refund_not_found'; review := false; return next; return;
  end if;

  if v_refund.attempts >= greatest(1, coalesce(p_max_attempts, 10)) then
    -- Never unfreezes and never reverses: the value stays exactly where the
    -- uncertainty left it, and a human decides.
    update public.gift_card_refunds
    set state = 'review_required',
        review_reason = 'gift_card_refund_reconciliation_exhausted',
        failure_category = left(coalesce(p_category, 'unknown'), 60),
        reconciliation_lease_until = null,
        reconciliation_worker = null
    where id = p_refund_id;
    outcome := 'review'; review := true; return next; return;
  end if;

  v_backoff := least(3600, 60 * power(2, least(greatest(v_refund.attempts - 1, 0), 6))::integer);

  update public.gift_card_refunds
  set reconciliation_lease_until = null,
      reconciliation_worker = null,
      reconciliation_next_at = now() + make_interval(secs => v_backoff),
      failure_category = left(coalesce(p_category, 'unknown'), 60)
  where id = p_refund_id;

  outcome := 'retry'; review := false; return next;
end;
$$;

revoke all on function public.defer_gift_card_refund(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.defer_gift_card_refund(uuid, text, integer) to service_role;
