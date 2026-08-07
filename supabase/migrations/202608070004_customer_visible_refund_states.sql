-- Customer-visible refund and dispute state.
--
-- WHAT A CUSTOMER IS ALLOWED TO SEE
-- =================================
-- `gift_card_refunds` and `store_credit_lots` are service-role only, and they
-- stay that way: they carry review reasons, provider ids, consumed amounts, and
-- the recipient's spending shape. None of that belongs in a browser.
--
-- These two readers project that state down to the smallest thing that answers
-- the customer's actual question:
--
--   purchaser -> "what happened to my refund?"   one of four words
--   recipient -> "why can't I spend my credit?"  an amount and a flag
--
-- Neither returns a reason, a provider identifier, an order id, a counterparty,
-- or anything that changes shape based on what the other party did. A purchaser
-- whose card was partially spent and one whose card is mid-chargeback see the
-- SAME string, because the difference between those two is the recipient's
-- business.

-- ===========================================================================
-- Purchaser
-- ===========================================================================

/**
 * The coarse state of every gift card the user bought that has one.
 *
 * Cards with nothing to report are omitted rather than returned as null, so the
 * caller renders a badge only when there is something to say.
 *
 * `disputed` outranks the refund states: if a chargeback is open, that is the
 * thing the purchaser needs to know, whatever a refund workflow says.
 */
create or replace function public.purchaser_gift_card_states(p_user_id uuid)
returns table(gift_card_id uuid, state text)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    case
      when c.disputed_at is not null and c.dispute_closed_at is null then 'disputed'
      when r.state = 'completed' then 'refunded'
      when r.state = 'review_required' then 'refund_review'
      when r.state in (
        'eligible_unclaimed', 'eligible_claimed_unused',
        'provider_refund_pending', 'provider_refund_failed'
      ) then 'refund_processing'
      -- A `rejected` refund is deliberately silent: it means the card was never
      -- eligible, the customer was told at request time, and a permanent badge
      -- reading "rejected" on their account is not information, it is a scar.
      else null
    end as state
  from public.gift_cards c
  left join lateral (
    select r2.state
    from public.gift_card_refunds r2
    where r2.gift_card_id = c.id
    order by r2.requested_at desc
    limit 1
  ) r on true
  where c.purchaser_user_id = p_user_id
    and (
      (c.disputed_at is not null and c.dispute_closed_at is null)
      or r.state is not null
    )
    and case
      when c.disputed_at is not null and c.dispute_closed_at is null then true
      else r.state <> 'rejected'
    end;
$$;

revoke all on function public.purchaser_gift_card_states(uuid) from public, anon, authenticated;
grant execute on function public.purchaser_gift_card_states(uuid) to service_role;

-- ===========================================================================
-- Recipient
-- ===========================================================================

/**
 * How much of the user's credit is on hold, and whether a hold was lifted
 * recently enough to be worth telling them.
 *
 * The hold is summed across lots WITHOUT naming which gift card, who sent it,
 * or that a dispute exists: the recipient is not a party to the chargeback.
 *
 * `restored_recently` is a 30-day window purely so the notice does not linger
 * forever on an account. It is a UI nicety, not a state machine.
 */
create or replace function public.recipient_credit_hold(p_user_id uuid)
returns table(hold_cents bigint, restored_recently boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(l.frozen_cents), 0)::bigint,
    coalesce(bool_or(
      l.frozen_cents = 0
      and c.dispute_status = 'won'
      and c.dispute_closed_at > now() - interval '30 days'
    ), false)
  from public.store_credit_lots l
  left join public.gift_cards c on c.id = l.gift_card_id
  where l.user_id = p_user_id;
$$;

revoke all on function public.recipient_credit_hold(uuid) from public, anon, authenticated;
grant execute on function public.recipient_credit_hold(uuid) to service_role;
