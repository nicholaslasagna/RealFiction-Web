-- Cash-redemption REVIEW. Not cash redemption.
--
-- WHAT THIS DOES AND DOES NOT DO
-- ==============================
-- Several US states require a gift-card balance to be redeemable for cash once
-- it falls below a threshold, and the details differ by state, by whether the
-- card was promotional, and by how the balance arose. That is a legal judgment,
-- not a rule a webhook can apply, so nothing here pays anybody. This creates a
-- reviewable request, freezes the value so it cannot be spent while a human
-- looks at it, and stops.
--
-- There is NO bank transfer, NO Stripe payout, NO automatic transition to
-- `completed`, and no code path that moves money outward. `manual_payout_required`
-- is the terminal state a person acts on, by hand, outside this system.
--
-- WHAT IS ELIGIBLE
-- ================
-- Only value that is BOTH gift-origin and genuinely unencumbered:
--
--   gift-origin        the lot's source is 'gift_card'. Promotional grants,
--                      manual grants, refund credit, and ordinary unlotted
--                      store credit are all excluded — none of them is a gift
--                      card, and none carries the obligation that makes cash
--                      redemption a legal question in the first place.
--   not frozen         a dispute or a pending refund has first claim on it.
--   not reserved       a live checkout allocation is already spending it.
--   not consumed       spent value is gone; it cannot be redeemed twice.
--   not disputed       the originating card has no open or lost dispute.
--   net of prior       anything a previous cash-redemption request already
--     redemptions      froze or paid out is subtracted.
--
-- RACE SAFETY
-- ===========
-- Both this and `reserve_credit_lots` take pg_advisory_xact_lock on
-- 'creditlots:<user>' and both work from `remaining_cents - frozen_cents`, so
-- one transaction always sees the other's outcome:
--
--   redemption freezes first -> frozen rises, the lot's spendable amount drops,
--                               and reserve_credit_lots skips it.
--   checkout reserves first  -> remaining drops, and this function computes a
--                               smaller eligible amount, or none at all.
--
-- The same cent can therefore never fund a purchase and a payout.

-- ===========================================================================
-- 1. The request
-- ===========================================================================

create table if not exists public.cash_redemption_requests (
  id uuid primary key default gen_random_uuid(),
  claimant_user_id uuid not null references public.profiles(id) on delete cascade,
  gift_card_id uuid references public.gift_cards(id) on delete restrict,
  lot_id uuid references public.store_credit_lots(id) on delete restrict,

  state text not null default 'requested' check (state in (
    'requested',
    'eligibility_review',
    'eligible',
    'ineligible',
    'manual_payout_required',
    'completed',
    'rejected'
  )),

  -- Server-computed at request time, under the lock. A client never supplies a
  -- number, and nothing downstream recomputes this upward.
  requested_cents bigint not null default 0 check (requested_cents >= 0),
  frozen_cents bigint not null default 0 check (frozen_cents >= 0),
  paid_out_cents bigint not null default 0 check (paid_out_cents >= 0),

  -- PROVENANCE SNAPSHOT, taken under the same lock as the freeze. Kept on the
  -- row rather than recomputed at review time: a reviewer must see the world as
  -- it was when the customer asked, not as it is after further spending.
  provenance jsonb not null default '{}'::jsonb,

  ineligible_reason text,
  review_note text,

  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  completed_at timestamptz
);

-- At most one live request per claimant. A second one while the first is open
-- would freeze the same value twice.
create unique index if not exists cash_redemption_one_live_idx
on public.cash_redemption_requests(claimant_user_id)
where state in ('requested', 'eligibility_review', 'eligible', 'manual_payout_required');

create index if not exists cash_redemption_claimant_idx
on public.cash_redemption_requests(claimant_user_id, requested_at desc);

create index if not exists cash_redemption_state_idx
on public.cash_redemption_requests(state, requested_at);

-- The provenance graph is not public. The claimant reads a coarse status
-- through a function; nobody reads this table from a browser.
alter table public.cash_redemption_requests enable row level security;
revoke all on table public.cash_redemption_requests from public, anon, authenticated;
grant all on table public.cash_redemption_requests to service_role;

-- ===========================================================================
-- 2. Provenance
-- ===========================================================================

/**
 * Everything a reviewer needs about one gift-origin lot, and nothing a customer
 * should see.
 *
 * Deliberately per-lot rather than per-account: cash-redemption obligations
 * attach to a CARD, and merging several cards into one number would lose the
 * originating purchaser, the original value, and which card the money came
 * from — the exact facts a review turns on.
 */
create or replace function public.gift_lot_provenance(p_lot_id uuid)
returns table(
  lot_id uuid,
  gift_card_id uuid,
  claimant_user_id uuid,
  purchaser_user_id uuid,
  original_cents bigint,
  remaining_cents bigint,
  frozen_cents bigint,
  reserved_cents bigint,
  consumed_cents bigint,
  prior_redeemed_cents bigint,
  disputed boolean,
  card_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.gift_card_id,
    l.user_id,
    c.purchaser_user_id,
    l.original_cents,
    l.remaining_cents,
    l.frozen_cents,
    coalesce((
      select sum(a.amount_cents) from public.store_credit_lot_allocations a
      where a.lot_id = l.id and a.state = 'reserved'
    ), 0)::bigint,
    coalesce((
      select sum(a.amount_cents - a.restored_cents) from public.store_credit_lot_allocations a
      where a.lot_id = l.id and a.state = 'consumed'
    ), 0)::bigint,
    coalesce((
      select sum(r.frozen_cents + r.paid_out_cents) from public.cash_redemption_requests r
      where r.lot_id = l.id
        and r.state in ('requested', 'eligibility_review', 'eligible', 'manual_payout_required', 'completed')
    ), 0)::bigint,
    -- An open dispute OR a lost one. A lost dispute leaves the card frozen and
    -- the money already clawed back; paying cash on top would pay twice.
    (c.disputed_at is not null and (c.dispute_closed_at is null or c.dispute_status = 'lost')),
    c.status::text
  from public.store_credit_lots l
  left join public.gift_cards c on c.id = l.gift_card_id
  where l.id = p_lot_id;
$$;

revoke all on function public.gift_lot_provenance(uuid) from public, anon, authenticated;
grant execute on function public.gift_lot_provenance(uuid) to service_role;

-- ===========================================================================
-- 3. Requesting
-- ===========================================================================

/**
 * The claimant's request.
 *
 * `p_lot_id` is optional: without it the largest eligible gift-origin lot is
 * chosen. Either way the AMOUNT is computed here, never supplied — a client
 * that could name a number could name a bigger one.
 *
 * Idempotent per claimant: a live request is returned as-is rather than
 * freezing a second time.
 */
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
  v_lot public.store_credit_lots%rowtype;
  v_prov record;
  v_eligible bigint;
  v_id uuid;
  v_existing public.cash_redemption_requests%rowtype;
begin
  -- The SAME lock reserve_credit_lots takes. This is the whole race proof.
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
  -- `frozen_cents` covers disputes and in-flight refunds. Prior redemptions are
  -- subtracted so a second request cannot re-freeze value the first one holds.
  v_eligible := greatest(
    0,
    v_lot.remaining_cents - v_lot.frozen_cents - coalesce(v_prov.prior_redeemed_cents, 0)
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
$$;

revoke all on function public.request_cash_redemption(uuid, uuid) from public, anon, authenticated;
grant execute on function public.request_cash_redemption(uuid, uuid) to service_role;

-- ===========================================================================
-- 4. Staff transitions
-- ===========================================================================

/**
 * Moves a request along. Service role only, driven by a person.
 *
 * `completed` is reachable ONLY from `manual_payout_required`, and only after
 * somebody has actually paid: this function records that a payout happened, it
 * does not make one. Nothing in this codebase calls it automatically.
 *
 * Refusing (`ineligible` / `rejected`) releases the freeze, because value we
 * are not redeeming belongs back in the customer's spendable balance.
 */
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

  outcome := p_state; released_cents := v_release;
  return next;
end;
$$;

revoke all on function public.resolve_cash_redemption(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.resolve_cash_redemption(uuid, text, text, bigint) to service_role;

-- ===========================================================================
-- 5. What the claimant may see
-- ===========================================================================

/**
 * The claimant's own view: a state and a date. No amount, no reason, no
 * provenance, no mention of the purchaser, and nothing about eligibility rules.
 *
 * Showing an amount would read as a promise of payment, and showing a reason
 * would publish the legal reasoning. Both are for the review record only.
 */
create or replace function public.my_cash_redemption_status(p_user_id uuid)
returns table(request_id uuid, state text, requested_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.state, r.requested_at
  from public.cash_redemption_requests r
  where r.claimant_user_id = p_user_id
  order by r.requested_at desc
  limit 1;
$$;

revoke all on function public.my_cash_redemption_status(uuid) from public, anon, authenticated;
grant execute on function public.my_cash_redemption_status(uuid) to service_role;

/** Whether an entry point should be offered at all. Boolean, not an amount. */
create or replace function public.has_gift_origin_credit(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.store_credit_lots l
    where l.user_id = p_user_id and l.source = 'gift_card' and l.remaining_cents > l.frozen_cents
  );
$$;

revoke all on function public.has_gift_origin_credit(uuid) from public, anon, authenticated;
grant execute on function public.has_gift_origin_credit(uuid) to service_role;
