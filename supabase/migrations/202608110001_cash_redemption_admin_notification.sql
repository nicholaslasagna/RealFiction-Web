-- Admin notification for a new cash-redemption review.
--
-- THE DEFECT THIS CLOSES
-- ======================
-- A customer could open a cash-redemption review — freezing real money — and no
-- operator was told. The only way to discover it was to query the database by
-- hand. The durable review row was always correct; nobody was ever notified it
-- existed.
--
-- WHERE THE ADDRESS COMES FROM
-- ============================
-- Not from here. The operations mailbox is deployment configuration, not schema,
-- and baking an address into a migration means changing it requires a
-- migration. This enqueues with an EMPTY recipient, which the processor
-- resolves from `CASH_REDEMPTION_ADMIN_EMAIL` at send time.
--
-- Empty rather than a placeholder address: a string like '@staff' is a value
-- that could be mistaken for a destination, could be accidentally sent to, and
-- would silently "work" while going nowhere. An empty recipient cannot be sent
-- to by accident — the processor either resolves it or parks the row as
-- unconfigured, and the row survives either way.
--
-- ATOMICITY
-- =========
-- The enqueue happens inside `request_cash_redemption`, in the same transaction
-- as the request row, the freeze, and the customer's email. Either all four
-- exist or none do. Nothing here sends anything: the outbox row is picked up by
-- the existing scheduled processor.
--
-- The email is a NOTIFICATION. `/admin/cash-redemptions` reads the request table
-- directly and is the source of truth, so a mail-provider outage delays the
-- alert but never hides the request.

begin;

-- ---------------------------------------------------------------------------
-- 1. The admin enqueue
-- ---------------------------------------------------------------------------
/**
 * Queues exactly one operations notification for a review.
 *
 * Idempotent on `cash_redemption_admin:<request_id>`: a retry, a double click,
 * or a replayed transaction cannot produce a second alert. The existing
 * `on conflict (idempotency_key) do nothing` is what enforces it.
 *
 * `params` carries only what an operator needs to triage. No claim secret, no
 * verifier, no ciphertext, no encryption key version, no payment identifiers,
 * no gift-card public reference. The account is identified by its id — the
 * admin page resolves anything further behind the staff boundary.
 */
create or replace function public.enqueue_cash_redemption_admin_email(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.email_deliveries (idempotency_key, template, recipient, order_id, params)
  select
    'cash_redemption_admin:' || r.id::text,
    'cash_redemption_admin_review',
    -- Resolved by the processor from CASH_REDEMPTION_ADMIN_EMAIL. See above.
    '',
    null,
    jsonb_build_object(
      'request_id', r.id,
      'claimant_user_id', r.claimant_user_id,
      'requested_cents', r.requested_cents,
      'frozen_cents', r.frozen_cents,
      'state', r.state,
      'requested_at', r.requested_at
    )
  from public.cash_redemption_requests r
  where r.id = p_request_id
  on conflict (idempotency_key) do nothing;
end;
$$;

revoke all on function public.enqueue_cash_redemption_admin_email(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_cash_redemption_admin_email(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. The wrapper now notifies BOTH parties
-- ---------------------------------------------------------------------------
-- Same signature, so no call site changes. The `already_open` guard is
-- unchanged and now governs the admin alert too: re-requesting an open review
-- returns the existing request and notifies nobody a second time.
create or replace function public.request_cash_redemption(
  p_claimant uuid,
  p_lot_id uuid default null
)
returns table(request_id uuid, state text, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result record;
begin
  select * into v_result from public.request_cash_redemption_core(p_claimant, p_lot_id);

  -- A GENUINELY NEW request. `already_open` means core returned the existing
  -- one, which has already produced both notifications.
  if v_result.request_id is not null and v_result.reason is distinct from 'already_open' then
    perform public.enqueue_cash_redemption_email(v_result.request_id, 'cash_redemption_received');
    perform public.enqueue_cash_redemption_admin_email(v_result.request_id);
  end if;

  request_id := v_result.request_id;
  state := v_result.state;
  reason := v_result.reason;
  return next;
end;
$$;

revoke all on function public.request_cash_redemption(uuid, uuid) from public, anon, authenticated;
grant execute on function public.request_cash_redemption(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The operational inbox
-- ---------------------------------------------------------------------------
/**
 * Everything /admin/cash-redemptions renders, in one query.
 *
 * OPEN REVIEWS FIRST, oldest first: the queue is worked top-down, and a request
 * that has waited longest is the one most likely to matter.
 *
 * `customer_notified` / `admin_notified` report the OUTBOX state, so an operator
 * can see that a notification failed without that failure hiding the request.
 * They are derived from `email_deliveries`, never stored on the request.
 */
create or replace function public.staff_cash_redemption_queue(p_limit integer default 200)
returns table(
  request_id uuid,
  claimant_user_id uuid,
  claimant_email text,
  minecraft_username text,
  state text,
  requested_cents bigint,
  frozen_cents bigint,
  paid_out_cents bigint,
  requested_at timestamptz,
  decided_at timestamptz,
  completed_at timestamptz,
  review_note text,
  ineligible_reason text,
  customer_notified text,
  admin_notified text,
  is_open boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.claimant_user_id,
    p.email,
    p.primary_minecraft_username,
    r.state,
    r.requested_cents,
    r.frozen_cents,
    r.paid_out_cents,
    r.requested_at,
    r.decided_at,
    r.completed_at,
    r.review_note,
    r.ineligible_reason,
    coalesce((
      select d.delivery_outcome from public.email_deliveries d
      where d.idempotency_key = 'cash_redemption_received:' || r.id::text
    ), 'not_queued'),
    coalesce((
      select d.delivery_outcome from public.email_deliveries d
      where d.idempotency_key = 'cash_redemption_admin:' || r.id::text
    ), 'not_queued'),
    r.state in ('requested', 'eligibility_review', 'eligible', 'manual_payout_required')
  from public.cash_redemption_requests r
  left join public.profiles p on p.id = r.claimant_user_id
  order by
    (r.state in ('requested', 'eligibility_review', 'eligible', 'manual_payout_required')) desc,
    r.requested_at asc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

revoke all on function public.staff_cash_redemption_queue(integer) from public, anon, authenticated;
grant execute on function public.staff_cash_redemption_queue(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Guard
-- ---------------------------------------------------------------------------
do $guard$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'request_cash_redemption'
      and p.prosrc like '%enqueue_cash_redemption_admin_email%'
      and p.prosrc like '%enqueue_cash_redemption_email%'
      and p.prosrc like '%request_cash_redemption_core%'
  ) then
    raise exception 'ABORT: the wrapper must delegate to core and notify BOTH parties';
  end if;
end
$guard$;

commit;
