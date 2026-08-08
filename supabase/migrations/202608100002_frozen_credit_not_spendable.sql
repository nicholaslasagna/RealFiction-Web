-- Frozen gift-origin credit must not be spendable.
--
-- THE DEFECT (RF-05)
-- ==================
-- Two systems described the same money in two places:
--
--   store_credit_ledger   the authoritative BALANCE
--   store_credit_lots     provenance, and `frozen_cents` — the hold a
--                         cash-redemption review or a refund places on value
--
-- `reserve_store_credit_for_order` checked only the LEDGER. A cash-redemption
-- freeze writes only to the LOT. So value frozen for a pending payout still
-- looked spendable, and the same cent could be reserved for a purchase AND
-- later paid out in cash.
--
-- Reproduced against a disposable database with two genuinely concurrent
-- connections: a $25 gift-origin balance, one connection requesting cash
-- redemption and one reserving $25 for an order. Both succeeded. After staff
-- completed the payout the ledger stood at MINUS 2500.
--
-- THE LOCK ORDER WAS ALSO WRONG
-- =============================
--   reserve_store_credit_for_order  took 'storecredit:<user>', then
--                                   reserve_credit_lots took 'creditlots:<user>'
--   request_cash_redemption         took ONLY 'creditlots:<user>'
--
-- So the balance check happened under one lock while the freeze happened under
-- another, and the freeze could land in the window between them. Holding a lock
-- that the other side never acquires is the same as holding no lock at all.
--
-- THE FIX
-- =======
--   1. The reservation subtracts frozen lot value from the spendable balance.
--   2. Both paths acquire BOTH locks, in the SAME order (storecredit then
--      creditlots), which both serialises them and makes deadlock impossible.

-- ---------------------------------------------------------------------------
-- 1. Spendable balance excludes frozen value
-- ---------------------------------------------------------------------------
create or replace function public.reserve_store_credit_for_order(
  p_order_id uuid,
  p_user_id uuid,
  p_amount_cents integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available bigint;
  v_frozen bigint;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    return false;
  end if;

  -- BOTH locks, in the canonical order. `reserve_credit_lots` below takes
  -- 'creditlots:' too; acquiring it here first is harmless (advisory locks are
  -- re-entrant within a transaction) and closes the window in which a freeze
  -- could land between the balance check and the allocation.
  perform pg_advisory_xact_lock(hashtext('storecredit:' || p_user_id::text));
  perform pg_advisory_xact_lock(hashtext('creditlots:' || p_user_id::text));

  -- Idempotent: a retry for the same order is a no-op success.
  if exists (
    select 1 from public.store_credit_ledger
    where idempotency_key = 'store_credit_reserve:' || p_order_id::text
  ) then
    return true;
  end if;

  select coalesce(sum(delta_cents), 0) into v_available
  from public.store_credit_ledger
  where user_id = p_user_id;

  -- Value held for a cash-redemption review or an in-flight refund. It is still
  -- in the ledger — it has not left the account — but it is NOT spendable, and
  -- the ledger alone cannot express that.
  select coalesce(sum(frozen_cents), 0) into v_frozen
  from public.store_credit_lots
  where user_id = p_user_id;

  if (v_available - v_frozen) < p_amount_cents then
    return false;
  end if;

  insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
  values (p_user_id, -p_amount_cents, 'store_credit_reserve', p_order_id::text,
          'store_credit_reserve:' || p_order_id::text, 'Reserved for checkout');

  update public.orders
  set store_credit_applied_cents = p_amount_cents,
      payment_due_cents = total_cents - p_amount_cents
  where id = p_order_id;

  perform public.reserve_credit_lots(p_user_id, p_order_id, p_amount_cents::bigint);

  return true;
end;
$$;

revoke all on function public.reserve_store_credit_for_order(uuid, uuid, integer)
from public, anon, authenticated;
grant execute on function public.reserve_store_credit_for_order(uuid, uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Cash redemption: same two locks, same order, and a ledger-bounded amount
-- ---------------------------------------------------------------------------
-- Patches request_cash_redemption_CORE, not the public wrapper.
--
-- A first attempt replaced the wrapper with the full logic and silently dropped
-- its `enqueue_cash_redemption_email` call — the claimant stopped receiving the
-- "we got your request" email. Caught by cash_redemption_emails.test.sql. The
-- wrapper is left exactly as it is; only the core's locking and eligibility
-- change.

CREATE OR REPLACE FUNCTION public.request_cash_redemption_core(p_claimant uuid, p_lot_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(request_id uuid, state text, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lot public.store_credit_lots%rowtype;
  v_prov record;
  v_eligible bigint;
  v_id uuid;
  v_existing public.cash_redemption_requests%rowtype;
begin
  -- The SAME lock reserve_credit_lots takes. This is the whole race proof.
  -- BOTH locks, in the SAME order reserve_store_credit_for_order uses
  -- (storecredit then creditlots). Previously this took only 'creditlots:',
  -- while the reservation's balance check ran under 'storecredit:' — so the
  -- two never excluded each other and a freeze could land in the window
  -- between the reservation's check and its write.
  perform pg_advisory_xact_lock(hashtext('storecredit:' || p_claimant::text));
  perform pg_advisory_xact_lock(hashtext('creditlots:' || p_claimant::text));

  -- Aliased: `state` is also an OUT parameter of this function.
  select * into v_existing from public.cash_redemption_requests r
  where r.claimant_user_id = p_claimant
    and r.state in ('requested', 'eligibility_review', 'eligible', 'manual_payout_required');
  if found then
    request_id := v_existing.id; state := v_existing.state; reason := 'already_open';
    return next; return;
  end if;

  -- ---- Pick the lot -------------------------------------------------------
  if p_lot_id is null then
    select * into v_lot from public.store_credit_lots l
    where l.user_id = p_claimant
      and l.source = 'gift_card'
      and l.remaining_cents > l.frozen_cents
    order by (l.remaining_cents - l.frozen_cents) desc, l.lot_seq
    limit 1
    for update;
  else
    select * into v_lot from public.store_credit_lots l
    where l.id = p_lot_id and l.user_id = p_claimant
    for update;
  end if;

  if not found then
    -- Covers "no gift credit at all" and "that lot is not yours" with the same
    -- answer, so the function cannot be used to probe for other people's lots.
    request_id := null; state := 'ineligible'; reason := 'no_eligible_gift_credit';
    return next; return;
  end if;

  -- Promotional, manual, and refund-origin credit are not gift cards.
  if v_lot.source <> 'gift_card' then
    request_id := null; state := 'ineligible'; reason := 'not_gift_origin';
    return next; return;
  end if;

  select * into v_prov from public.gift_lot_provenance(v_lot.id);

  if v_prov.disputed then
    request_id := null; state := 'ineligible'; reason := 'disputed';
    return next; return;
  end if;

  -- ---- The eligible amount, computed HERE ---------------------------------
  -- `remaining_cents` is already net of every reservation and every spend, and
  -- `frozen_cents` covers disputes, in-flight refunds, AND any live redemption
  -- freeze. That is the whole answer.
  --
  -- `prior_redeemed_cents` is deliberately NOT subtracted here, even though it
  -- is reported to the reviewer. Subtracting it double-counts: a live request's
  -- value sits in `frozen_cents` (already removed by the line below), and a
  -- COMPLETED one already had `remaining_cents` decremented when it completed.
  -- Doing both left a customer who had redeemed part of a card unable to redeem
  -- the rest — under-redeeming, so never unsafe, but wrong, and wrong in a
  -- direction that quietly denies people money the law may owe them.
  v_eligible := greatest(0, v_lot.remaining_cents - v_lot.frozen_cents);

  -- Bounded by the LEDGER too. The lot tracks provenance; the ledger is the
  -- balance. A reservation that consumed ledger credit without a matching lot
  -- allocation would otherwise leave the lot looking richer than the account
  -- actually is, and freezing that difference is how the same cent got both
  -- spent and paid out.
  v_eligible := least(
    v_eligible,
    greatest(0, (select coalesce(sum(delta_cents), 0) from public.store_credit_ledger
                 where user_id = p_claimant))
  );

  if v_eligible <= 0 then
    request_id := null; state := 'ineligible'; reason := 'no_eligible_value';
    return next; return;
  end if;

  -- ---- Freeze, then record ------------------------------------------------
  -- Freezing FIRST is what makes the race safe: from this statement on, the
  -- lot's spendable amount excludes this value and reserve_credit_lots skips it.
  update public.store_credit_lots
  set frozen_cents = frozen_cents + v_eligible
  where id = v_lot.id;

  insert into public.cash_redemption_requests (
    claimant_user_id, gift_card_id, lot_id, state, requested_cents, frozen_cents, provenance
  )
  values (
    p_claimant, v_lot.gift_card_id, v_lot.id, 'requested', v_eligible, v_eligible,
    jsonb_build_object(
      'gift_card_id', v_prov.gift_card_id,
      'purchaser_user_id', v_prov.purchaser_user_id,
      'claimant_user_id', p_claimant,
      'original_cents', v_prov.original_cents,
      'remaining_cents', v_prov.remaining_cents,
      'frozen_cents', v_prov.frozen_cents,
      'reserved_cents', v_prov.reserved_cents,
      'consumed_cents', v_prov.consumed_cents,
      'prior_redeemed_cents', v_prov.prior_redeemed_cents,
      'card_status', v_prov.card_status
    )
  )
  returning id into v_id;

  -- A human owns it from here. No payout, no scheduled job, no state machine
  -- that advances on its own.
  insert into public.payment_reviews (provider, provider_event_id, event_type, order_id, reason, detail)
  values (
    'internal', 'cash_redemption:' || v_id::text, 'cash_redemption_request', null,
    'cash_redemption_eligibility_review',
    jsonb_build_object(
      'priority', 'high',
      'request_id', v_id,
      'requires_legal_review', true,
      'no_automatic_payout', true
    )
  )
  on conflict (provider, provider_event_id) do nothing;

  request_id := v_id; state := 'requested'; reason := null;
  return next;
end;
$function$;

revoke all on function public.request_cash_redemption_core(uuid, uuid) from public, anon, authenticated;
grant execute on function public.request_cash_redemption_core(uuid, uuid) to service_role;
