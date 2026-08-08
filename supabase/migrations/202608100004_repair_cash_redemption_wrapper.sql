-- Repairs the cash-redemption EMAIL + WRAPPER path in production.
--
-- WHAT WENT WRONG
-- ===============
-- Production applied 202608080002 in its FIRST form (commit 581d39e), in which
-- `request_cash_redemption` held all the logic and there was no wrapper/core
-- split and no email at all. The later form of that same file — which added
-- `enqueue_cash_redemption_email`, split the logic into
-- `request_cash_redemption_core`, and made `request_cash_redemption` a thin
-- wrapper that calls core and then enqueues the email — was never applied.
--
-- 202608100002 then replaced `request_cash_redemption_core`. On a database that
-- never had the split, `create or replace` CREATED that function fresh. So
-- production now has:
--
--   request_cash_redemption       old full logic, no email, does NOT call core
--   request_cash_redemption_core  correct and RF-05-fixed, but ORPHANED
--   enqueue_cash_redemption_email absent entirely
--
-- The application calls `request_cash_redemption`, so the RF-05 lock/clamp work
-- in core is currently dead code on the live path.
--
-- WHAT IS AND IS NOT AT RISK
-- ==========================
-- RF-05 itself is NOT exploitable: `reserve_store_credit_for_order` was also
-- replaced by 202608100002 and correctly subtracts frozen cents, which is what
-- actually blocks the spend. Verified against a rebuilt copy of this exact
-- state — the spend is refused.
--
-- Two real defects remain on the live path:
--   1. a claimant receives NO email for a cash-redemption request; and
--   2. the old function has no ledger clamp, so it can freeze MORE than the
--      account's spendable balance (reproduced: froze 5000 against a 1000
--      ledger balance).
--
-- This migration is forward-only. It does not re-run or rewrite 202608080002,
-- does not touch `request_cash_redemption_core` (already correct), and changes
-- no data.

begin;

-- ---------------------------------------------------------------------------
-- 1. The email helper, if production never received it
-- ---------------------------------------------------------------------------
-- Idempotent by construction: the outbox row carries a deterministic
-- idempotency key, so a retry or a re-run cannot queue a second email.
create or replace function public.enqueue_cash_redemption_email(
  p_request_id uuid,
  p_template text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No amount in the params, for the same reason no amount is on the account
  -- page: a number in an email about a possible payout reads as the payout.
  insert into public.email_deliveries (idempotency_key, template, recipient, order_id, params)
  select
    p_template || ':' || p_request_id::text, p_template, p.email, null, '{}'::jsonb
  from public.cash_redemption_requests r
  join public.profiles p on p.id = r.claimant_user_id
  where r.id = p_request_id and coalesce(p.email, '') <> ''
  on conflict (idempotency_key) do nothing;
end;
$$;

revoke all on function public.enqueue_cash_redemption_email(uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_cash_redemption_email(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. The wrapper — restores the architecture and the email
-- ---------------------------------------------------------------------------
-- Same signature, so `create or replace` is sufficient and no application call
-- site changes. This is what re-connects the RF-05-fixed core to the live path.
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

  if v_result.request_id is not null and v_result.reason is distinct from 'already_open' then
    perform public.enqueue_cash_redemption_email(v_result.request_id, 'cash_redemption_received');
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
-- 3. resolve_cash_redemption — its email calls were also never applied
-- ---------------------------------------------------------------------------
-- The old form exists in production but emits no closed/completed email,
-- because `enqueue_cash_redemption_email` did not exist when it was created.
create or replace function public.resolve_cash_redemption(
  p_request_id uuid,
  p_state text,
  p_note text default null,
  p_paid_out_cents bigint default 0
)
returns table(outcome text, released_cents bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.cash_redemption_requests%rowtype;
  v_release bigint := 0;
begin
  select * into v_req from public.cash_redemption_requests where id = p_request_id for update;
  if not found then
    outcome := 'not_found'; released_cents := 0; return next; return;
  end if;

  if v_req.state in ('completed', 'rejected', 'ineligible') then
    outcome := 'already_final'; released_cents := 0; return next; return;
  end if;

  if p_state not in ('eligibility_review', 'eligible', 'ineligible', 'manual_payout_required', 'completed', 'rejected') then
    outcome := 'invalid_state'; released_cents := 0; return next; return;
  end if;

  if p_state = 'completed' and v_req.state <> 'manual_payout_required' then
    -- A payout has to have been arranged before it can be recorded as done.
    outcome := 'payout_not_authorized'; released_cents := 0; return next; return;
  end if;

  perform pg_advisory_xact_lock(hashtext('creditlots:' || v_req.claimant_user_id::text));

  if p_state in ('ineligible', 'rejected') then
    v_release := v_req.frozen_cents;
    if v_release > 0 and v_req.lot_id is not null then
      update public.store_credit_lots
      set frozen_cents = greatest(0, frozen_cents - v_release)
      where id = v_req.lot_id;
    end if;
  end if;

  if p_state = 'completed' then
    -- The value leaves the account for good: it was paid in cash. The freeze
    -- becomes a removal, so the balance and the lot agree.
    if v_req.lot_id is not null then
      update public.store_credit_lots
      set remaining_cents = greatest(0, remaining_cents - v_req.frozen_cents),
          frozen_cents = greatest(0, frozen_cents - v_req.frozen_cents)
      where id = v_req.lot_id;
    end if;

    insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
    values (
      v_req.claimant_user_id, -v_req.frozen_cents, 'manual_revoke', v_req.id::text,
      'cash_redemption:' || v_req.id::text, 'Redeemed for cash'
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing;
  end if;

  update public.cash_redemption_requests
  set state = p_state,
      review_note = coalesce(p_note, review_note),
      ineligible_reason = case when p_state = 'ineligible' then coalesce(p_note, 'reviewed') else ineligible_reason end,
      frozen_cents = case when p_state in ('ineligible', 'rejected', 'completed') then 0 else frozen_cents end,
      paid_out_cents = case when p_state = 'completed' then greatest(0, coalesce(p_paid_out_cents, 0)) else paid_out_cents end,
      decided_at = coalesce(decided_at, now()),
      completed_at = case when p_state = 'completed' then now() else completed_at end
  where id = p_request_id;

  -- Only the states a customer should hear about. `eligibility_review`,
  -- `eligible`, and `manual_payout_required` are internal progress and send
  -- nothing — see the notification note at the end of this file.
  if p_state in ('ineligible', 'rejected') then
    perform public.enqueue_cash_redemption_email(p_request_id, 'cash_redemption_closed');
  elsif p_state = 'completed' then
    perform public.enqueue_cash_redemption_email(p_request_id, 'cash_redemption_completed');
  end if;

  outcome := p_state; released_cents := v_release;
  return next;
end;
$$;

revoke all on function public.resolve_cash_redemption(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.resolve_cash_redemption(uuid, text, text, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Guard — fail closed rather than leaving a half-repaired path
-- ---------------------------------------------------------------------------
do $guard$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enqueue_cash_redemption_email'
  ) then
    raise exception 'ABORT: enqueue_cash_redemption_email was not created';
  end if;

  -- The wrapper must delegate to core AND enqueue. Either one missing means the
  -- architecture is still broken.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'request_cash_redemption'
      and p.prosrc like '%request_cash_redemption_core%'
      and p.prosrc like '%enqueue_cash_redemption_email%'
  ) then
    raise exception 'ABORT: request_cash_redemption is not a wrapper that emails';
  end if;

  -- Core must still carry the RF-05 fix. This migration must never regress it.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'request_cash_redemption_core'
      and p.prosrc like '%storecredit:%' and p.prosrc like '%creditlots:%'
  ) then
    raise exception 'ABORT: request_cash_redemption_core lost its RF-05 locking';
  end if;
end
$guard$;

commit;
