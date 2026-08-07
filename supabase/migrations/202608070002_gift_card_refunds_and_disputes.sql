-- Gift-card refunds and disputes.
--
-- WHY THE ORDINARY PATH IS UNSAFE HERE
-- ===================================
-- `revoke_order` reverses entitlements and queues compensating RealCore
-- rewards. It knows nothing about `gift_cards` or `store_credit_lots`, and a
-- gift card is `consumable`, so for a gift-card order it does almost nothing —
-- it does not invalidate the claim credential, does not void the card, and does
-- not touch the stored value.
--
-- Which means, today: refund a CLAIMED $25 gift card and the customer gets
-- $25 back AND keeps $25 of spendable credit. That is the defect this closes.
--
-- THE SHAPE OF THE ANSWER
-- =======================
-- Stored value is not an entitlement. Whether a refund is safe depends on what
-- has happened to the VALUE, not to the order:
--
--   unclaimed          -> void it, refund the money, nobody was ever credited
--   claimed, unused    -> reverse the exact credit, then refund the money
--   claimed, spent     -> a human decides; automatic refund would pay twice
--   partial request    -> a human decides; ambiguous ownership once issued
--
-- The order matters. For a claimed card the value is FROZEN before Stripe is
-- asked, so the recipient cannot spend it while the refund is in flight, and
-- the ledger reversal happens only after the provider confirms. Neither of the
-- two silent failures is reachable: "refunded but still spendable" or "value
-- removed but never refunded".
--
-- Nothing here calls Stripe. Postgres cannot, and should not: the application
-- owns the provider call and reports the result back.

-- ===========================================================================
-- 0. Per-order external refund ledger
-- ===========================================================================
-- Required by every refund ceiling below, and absent today: the earlier version
-- of this table went out with the upgrade-credit migration that the product
-- correction removed. Re-added minimally, for ordinary and gift-card orders
-- alike — a refund ceiling cannot be computed without a durable record of what
-- has already been sent back.

create table if not exists public.order_refunds (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null default 'stripe',
  provider_refund_id text,
  external_refund_cents bigint not null default 0 check (external_refund_cents >= 0),
  store_credit_restored_cents bigint not null default 0 check (store_credit_restored_cents >= 0),
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

-- Stripe emits several events per Refund; all of them must add up to one row.
create unique index if not exists order_refunds_provider_refund_idx
on public.order_refunds(provider, provider_refund_id)
where provider_refund_id is not null;

create index if not exists order_refunds_order_idx on public.order_refunds(order_id);

alter table public.order_refunds enable row level security;
revoke all on table public.order_refunds from public, anon, authenticated;
grant all on table public.order_refunds to service_role;

/**
 * Records one external reversal, bounded by what was actually collected.
 *
 * FAILS CLOSED rather than clamping: a refund larger than the payment means our
 * model of the order disagrees with Stripe's, and quietly recording the smaller
 * number would hide that. `payment_due_cents` is the ceiling — never
 * `subtotal_cents`, which is merchandise value nobody ever paid.
 */
create or replace function public.record_order_refund(
  p_order_id uuid,
  p_provider_refund_id text,
  p_external_refund_cents bigint,
  p_currency text default 'USD',
  p_restore_store_credit boolean default false
)
returns table(recorded boolean, outcome text, external_applied_cents bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_already bigint;
  v_ceiling bigint;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    recorded := false; outcome := 'order_not_found'; external_applied_cents := 0;
    return next; return;
  end if;

  if p_external_refund_cents is null or p_external_refund_cents < 0 then
    recorded := false; outcome := 'negative_or_missing_amount'; external_applied_cents := 0;
    return next; return;
  end if;

  if upper(coalesce(p_currency, 'USD')) <> upper(coalesce(v_order.currency, 'USD')) then
    recorded := false; outcome := 'currency_mismatch'; external_applied_cents := 0;
    return next; return;
  end if;

  if p_provider_refund_id is not null and p_provider_refund_id <> ''
     and exists (
       select 1 from public.order_refunds
       where provider = 'stripe' and provider_refund_id = p_provider_refund_id
     ) then
    recorded := false; outcome := 'duplicate'; external_applied_cents := 0;
    return next; return;
  end if;

  select coalesce(sum(external_refund_cents), 0) into v_already
  from public.order_refunds where order_id = p_order_id;

  v_ceiling := greatest(0, coalesce(v_order.payment_due_cents, v_order.total_cents, 0)) - v_already;

  if p_external_refund_cents > v_ceiling then
    recorded := false; outcome := 'exceeds_external_payment'; external_applied_cents := 0;
    return next; return;
  end if;

  insert into public.order_refunds (
    order_id, provider, provider_refund_id, external_refund_cents, currency
  )
  values (
    p_order_id, 'stripe', nullif(p_provider_refund_id, ''), p_external_refund_cents,
    upper(coalesce(p_currency, 'USD'))
  );

  recorded := true; outcome := 'recorded'; external_applied_cents := p_external_refund_cents;
  return next;
end;
$$;

revoke all on function public.record_order_refund(uuid, text, bigint, text, boolean) from public, anon, authenticated;
grant execute on function public.record_order_refund(uuid, text, bigint, text, boolean) to service_role;

-- ===========================================================================
-- 1. Refund state machine
-- ===========================================================================

create table if not exists public.gift_card_refunds (
  id uuid primary key default extensions.gen_random_uuid(),
  gift_card_id uuid not null references public.gift_cards(id) on delete restrict,
  purchaser_order_id uuid references public.orders(id) on delete set null,

  state text not null default 'requested' check (state in (
    'requested',
    'eligible_unclaimed',
    'eligible_claimed_unused',
    'review_required',
    'provider_refund_pending',
    'provider_refund_succeeded',
    'provider_refund_failed',
    'reversal_pending',
    'completed',
    'rejected'
  )),

  -- Snapshot of the facts the decision was made on, so a later reader can see
  -- WHY without re-deriving it from state that has since moved.
  face_value_cents bigint not null check (face_value_cents >= 0),
  external_paid_cents bigint not null check (external_paid_cents >= 0),
  requested_cents bigint not null check (requested_cents >= 0),
  eligible_external_cents bigint not null default 0 check (eligible_external_cents >= 0),
  gift_origin_remaining_cents bigint not null default 0,
  gift_origin_reserved_cents bigint not null default 0,
  gift_origin_consumed_cents bigint not null default 0,

  provider_refund_id text,
  attempts integer not null default 0,
  -- Safe category only. Never a Stripe response body.
  failure_category text,
  review_reason text,

  requested_at timestamptz not null default now(),
  provider_requested_at timestamptz,
  completed_at timestamptz,
  rejected_at timestamptz
);

-- ONE live refund per card. A second request while one is in flight is a
-- constraint violation, not a race that mints two provider calls.
create unique index if not exists gift_card_refunds_one_live_idx
on public.gift_card_refunds(gift_card_id)
where state not in ('completed', 'rejected');

create unique index if not exists gift_card_refunds_provider_idx
on public.gift_card_refunds(provider_refund_id)
where provider_refund_id is not null;

create index if not exists gift_card_refunds_card_idx on public.gift_card_refunds(gift_card_id, requested_at desc);

alter table public.gift_card_refunds enable row level security;
revoke all on table public.gift_card_refunds from public, anon, authenticated;
grant all on table public.gift_card_refunds to service_role;

-- Dispute state lives on the card; a card has at most one open dispute.
alter table public.gift_cards
  add column if not exists disputed_at timestamptz,
  add column if not exists dispute_status text,
  add column if not exists dispute_closed_at timestamptz;

-- ===========================================================================
-- 2. What is true about this card's value, right now
-- ===========================================================================

/**
 * The authoritative position of one gift card.
 *
 * `external_paid_cents` is what Stripe ACTUALLY collected for the purchase
 * order — never the face value, which is a product attribute and not payment
 * evidence. A card issued by an operator, or one whose order was partially
 * refunded already, must not be refundable for its printed amount.
 */
create or replace function public.gift_card_position(p_gift_card_id uuid)
returns table(
  gift_card_id uuid,
  purchaser_order_id uuid,
  status text,
  claimed boolean,
  frozen boolean,
  disputed boolean,
  face_value_cents bigint,
  external_paid_cents bigint,
  external_refunded_cents bigint,
  external_remaining_cents bigint,
  lot_remaining_cents bigint,
  lot_reserved_cents bigint,
  lot_consumed_cents bigint,
  lot_frozen_cents bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.id,
    g.purchaser_order_id,
    g.status::text,
    g.claimed_by is not null,
    g.frozen_at is not null,
    g.disputed_at is not null and g.dispute_closed_at is null,
    coalesce(g.original_balance_cents, 0)::bigint,
    -- What was actually collected externally for the purchase.
    coalesce(o.payment_due_cents, o.total_cents, 0)::bigint,
    coalesce(r.ext_refunded, 0)::bigint,
    greatest(0, coalesce(o.payment_due_cents, o.total_cents, 0) - coalesce(r.ext_refunded, 0))::bigint,
    coalesce(l.remaining_cents, 0)::bigint,
    coalesce(a.reserved, 0)::bigint,
    coalesce(a.consumed, 0)::bigint,
    coalesce(l.frozen_cents, 0)::bigint
  from public.gift_cards g
  left join public.orders o on o.id = g.purchaser_order_id
  left join public.store_credit_lots l on l.gift_card_id = g.id
  left join lateral (
    select sum(external_refund_cents) as ext_refunded
    from public.order_refunds x where x.order_id = g.purchaser_order_id
  ) r on true
  left join lateral (
    select
      coalesce(sum(amount_cents) filter (where state = 'reserved'), 0) as reserved,
      coalesce(sum(amount_cents) filter (where state = 'consumed'), 0) as consumed
    from public.store_credit_lot_allocations al where al.lot_id = l.id
  ) a on true
  where g.id = p_gift_card_id
$$;

revoke all on function public.gift_card_position(uuid) from public, anon, authenticated;
grant execute on function public.gift_card_position(uuid) to service_role;

/**
 * Every ordinary order funded by this card, for staff review.
 *
 * Service-role only, and deliberately free of any claim credential. The
 * purchaser must never see this: it is the recipient's spending history.
 */
create or replace function public.gift_card_downstream_funding(p_gift_card_id uuid)
returns table(
  funded_order_id uuid,
  allocation_state text,
  amount_cents bigint,
  restored_cents bigint,
  order_status text,
  product_slugs text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    al.order_id,
    al.state,
    al.amount_cents,
    al.restored_cents,
    o.status::text,
    array_agg(distinct coalesce(oi.product_snapshot->>'slug', 'unknown'))
  from public.store_credit_lots l
  join public.store_credit_lot_allocations al on al.lot_id = l.id
  join public.orders o on o.id = al.order_id
  left join public.order_items oi on oi.order_id = o.id
  where l.gift_card_id = p_gift_card_id
  group by al.order_id, al.state, al.amount_cents, al.restored_cents, o.status
$$;

revoke all on function public.gift_card_downstream_funding(uuid) from public, anon, authenticated;
grant execute on function public.gift_card_downstream_funding(uuid) to service_role;

-- ===========================================================================
-- 3. Begin a refund
-- ===========================================================================

/**
 * Evaluates eligibility under a lock and moves the card into the matching
 * state. Calls no provider.
 *
 * The lock is the point: claim, reservation, and refund all contend for the
 * same value, and eligibility computed outside a lock is a guess that was true
 * a moment ago. Everything that could change the answer is locked here.
 *
 * A claimed-unused card is FROZEN before returning, so the recipient cannot
 * spend value the application is about to ask Stripe to refund.
 */
create or replace function public.begin_gift_card_refund(
  p_gift_card_id uuid,
  p_requested_cents bigint default null
)
returns table(refund_id uuid, state text, eligible_external_cents bigint, review_reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.gift_cards%rowtype;
  v_pos record;
  v_state text;
  v_reason text := null;
  v_eligible bigint := 0;
  v_id uuid;
  v_requested bigint;
begin
  -- Lock the card, then the lot, in that order everywhere.
  select * into v_card from public.gift_cards where id = p_gift_card_id for update;
  if not found then
    refund_id := null; state := 'rejected'; eligible_external_cents := 0;
    review_reason := 'gift_card_not_found';
    return next; return;
  end if;

  perform 1 from public.store_credit_lots where gift_card_id = p_gift_card_id for update;

  select * into v_pos from public.gift_card_position(p_gift_card_id);
  v_requested := coalesce(p_requested_cents, v_pos.external_remaining_cents);

  -- An existing live refund wins; this is not a second attempt.
  -- Aliased: the OUT parameters `state` and `review_reason` share their names
  -- with columns here, which Postgres resolves as ambiguous.
  select r.id into v_id from public.gift_card_refunds r
  where r.gift_card_id = p_gift_card_id and r.state not in ('completed', 'rejected');
  if found then
    select r.state, r.eligible_external_cents, r.review_reason
      into v_state, v_eligible, v_reason
    from public.gift_card_refunds r where r.id = v_id;
    refund_id := v_id; state := v_state; eligible_external_cents := v_eligible;
    review_reason := v_reason;
    return next; return;
  end if;

  -- ---- Eligibility ------------------------------------------------------
  if v_pos.external_paid_cents <= 0 then
    -- Never externally paid, so there is no money to return. A gift card
    -- cannot be bought with store credit, so this should be unreachable.
    v_state := 'rejected'; v_reason := 'no_external_payment';

  elsif v_pos.external_remaining_cents <= 0 then
    v_state := 'rejected'; v_reason := 'already_fully_refunded';

  elsif v_requested < v_pos.external_remaining_cents then
    -- PARTIAL. Ambiguous once a card exists: which part of the stored value
    -- does the refunded fraction correspond to? A human decides.
    v_state := 'review_required'; v_reason := 'gift_card_partial_refund_requested';

  elsif v_requested > v_pos.external_remaining_cents then
    v_state := 'rejected'; v_reason := 'exceeds_external_payment';

  elsif v_pos.disputed or v_pos.frozen or v_pos.lot_frozen_cents > 0 then
    -- An OPEN dispute is the obvious case. A CLOSED-LOST one is the subtle one:
    -- the card stays frozen, `disputed` is false because the dispute is over,
    -- and without this the value would look like untouched claimed-unused
    -- credit and be automatically refunded — paying the purchaser after the
    -- chargeback already took the money. Found by the test below.
    v_state := 'review_required'; v_reason := 'gift_card_refund_dispute_conflict';

  elsif not v_pos.claimed then
    -- Nobody was ever credited. Void it and refund.
    v_state := 'eligible_unclaimed'; v_eligible := v_pos.external_remaining_cents;

  elsif v_pos.lot_consumed_cents > 0 then
    v_state := 'review_required';
    v_reason := case
      when v_pos.lot_remaining_cents > 0 then 'gift_card_claimed_partially_spent'
      else 'gift_card_claimed_fully_spent'
    end;

  elsif v_pos.lot_reserved_cents > 0 then
    -- The value could still fund an order that is mid-checkout.
    v_state := 'review_required'; v_reason := 'gift_card_active_reservation';

  elsif v_pos.lot_remaining_cents = v_pos.face_value_cents then
    v_state := 'eligible_claimed_unused'; v_eligible := v_pos.external_remaining_cents;

  else
    v_state := 'review_required'; v_reason := 'gift_card_provider_mismatch';
  end if;

  insert into public.gift_card_refunds (
    gift_card_id, purchaser_order_id, state, face_value_cents, external_paid_cents,
    requested_cents, eligible_external_cents, gift_origin_remaining_cents,
    gift_origin_reserved_cents, gift_origin_consumed_cents, review_reason,
    rejected_at
  )
  values (
    p_gift_card_id, v_pos.purchaser_order_id, v_state, v_pos.face_value_cents,
    v_pos.external_paid_cents, v_requested, v_eligible, v_pos.lot_remaining_cents,
    v_pos.lot_reserved_cents, v_pos.lot_consumed_cents, v_reason,
    case when v_state = 'rejected' then now() else null end
  )
  returning id into v_id;

  -- An unclaimed card stops being claimable the moment a refund starts. A
  -- claimed-unused card's remaining value stops being spendable.
  if v_state = 'eligible_unclaimed' then
    -- Aliased: `state` is also an OUT parameter of this function.
    update public.gift_card_claim_credentials c
    set state = 'invalidated', invalidated_at = now(), invalidated_reason = 'refund_requested'
    where c.gift_card_id = p_gift_card_id and c.state = 'active';

  elsif v_state = 'eligible_claimed_unused' then
    update public.store_credit_lots
    set frozen_cents = remaining_cents
    where gift_card_id = p_gift_card_id;
  end if;

  if v_state = 'review_required' then
    insert into public.payment_reviews (provider, provider_event_id, event_type, order_id, reason, detail)
    values (
      'stripe', 'gift_card_refund:' || v_id::text, 'gift_card_refund_review',
      v_pos.purchaser_order_id, v_reason,
      jsonb_build_object(
        'priority', 'high',
        'gift_card_id', p_gift_card_id,
        'refund_id', v_id,
        'remaining_cents', v_pos.lot_remaining_cents,
        'reserved_cents', v_pos.lot_reserved_cents,
        'consumed_cents', v_pos.lot_consumed_cents,
        'external_remaining_cents', v_pos.external_remaining_cents
      )
    )
    on conflict (provider, provider_event_id) do nothing;
  end if;

  refund_id := v_id; state := v_state; eligible_external_cents := v_eligible;
  review_reason := v_reason;
  return next;
end;
$$;

revoke all on function public.begin_gift_card_refund(uuid, bigint) from public, anon, authenticated;
grant execute on function public.begin_gift_card_refund(uuid, bigint) to service_role;

/** Marks the provider call in flight, so a retry does not issue a second one. */
create or replace function public.mark_gift_card_refund_pending(p_refund_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_rows integer;
begin
  update public.gift_card_refunds
  set state = 'provider_refund_pending',
      provider_requested_at = coalesce(provider_requested_at, now()),
      attempts = attempts + 1
  where id = p_refund_id
    and state in ('eligible_unclaimed', 'eligible_claimed_unused', 'provider_refund_failed');

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.mark_gift_card_refund_pending(uuid) from public, anon, authenticated;
grant execute on function public.mark_gift_card_refund_pending(uuid) to service_role;

-- ===========================================================================
-- 4. Complete a refund, after the provider confirms
-- ===========================================================================

/**
 * Finalises a confirmed external refund. ONE transaction.
 *
 * For an unclaimed card: void it. For a claimed-unused card: reverse exactly
 * the credit that was granted, never more, and never into a negative balance —
 * the reversal is bounded by what remains, and the lot was frozen at the same
 * value before the provider was called, so nothing could have been spent in
 * between.
 *
 * Idempotent on the provider refund id: several Stripe events for one Refund
 * produce exactly one reversal.
 */
create or replace function public.complete_gift_card_refund(
  p_refund_id uuid,
  p_provider_refund_id text,
  p_refunded_cents bigint
)
returns table(outcome text, reversed_cents bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.gift_card_refunds%rowtype;
  v_card public.gift_cards%rowtype;
  v_lot public.store_credit_lots%rowtype;
  v_reverse bigint := 0;
begin
  select * into v_refund from public.gift_card_refunds where id = p_refund_id for update;
  if not found then
    outcome := 'refund_not_found'; reversed_cents := 0; return next; return;
  end if;

  if v_refund.state = 'completed' then
    outcome := 'already_completed'; reversed_cents := 0; return next; return;
  end if;

  select * into v_card from public.gift_cards where id = v_refund.gift_card_id for update;
  select * into v_lot from public.store_credit_lots where gift_card_id = v_refund.gift_card_id for update;

  -- CEILING. Never more than the external payment that is still outstanding.
  if coalesce(p_refunded_cents, 0) > v_refund.eligible_external_cents then
    update public.gift_card_refunds
    set state = 'review_required',
        review_reason = 'gift_card_provider_mismatch',
        failure_category = 'refund_exceeds_eligible'
    where id = p_refund_id;

    outcome := 'exceeds_eligible'; reversed_cents := 0; return next; return;
  end if;

  -- Record the external reversal against the purchase order, bounded and
  -- idempotent by the existing per-tender ledger.
  if v_refund.purchaser_order_id is not null then
    perform public.record_order_refund(
      v_refund.purchaser_order_id, p_provider_refund_id, p_refunded_cents, 'USD', false
    );
  end if;

  if v_lot.id is not null then
    -- Reverse EXACTLY what remains, which the freeze pinned before the provider
    -- call. `greatest(0, ...)` and the lot's own check constraint make a
    -- negative balance unreachable rather than merely unlikely.
    v_reverse := greatest(0, v_lot.remaining_cents);

    if v_reverse > 0 then
      insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
      values (
        v_lot.user_id, -v_reverse, 'manual_revoke', v_refund.gift_card_id::text,
        'gift_card_refund_reversal:' || v_refund.gift_card_id::text,
        'Gift card refunded'
      )
      on conflict (idempotency_key) where idempotency_key is not null do nothing;

      if not found then
        -- Already reversed by an earlier event.
        v_reverse := 0;
      else
        update public.store_credit_lots
        set remaining_cents = 0, frozen_cents = 0
        where id = v_lot.id;
      end if;
    end if;
  end if;

  update public.gift_cards
  set status = 'void',
      voided_at = coalesce(voided_at, now()),
      void_reason = coalesce(void_reason, 'refunded'),
      balance_cents = 0
  where id = v_refund.gift_card_id;

  update public.gift_card_claim_credentials
  set state = 'invalidated', invalidated_at = now(), invalidated_reason = 'refunded'
  where gift_card_id = v_refund.gift_card_id and state = 'active';

  update public.gift_card_refunds
  set state = 'completed',
      provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id),
      completed_at = now()
  where id = p_refund_id;

  outcome := 'completed'; reversed_cents := v_reverse;
  return next;
end;
$$;

revoke all on function public.complete_gift_card_refund(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.complete_gift_card_refund(uuid, text, bigint) to service_role;

/** Records a provider failure. Keeps the refund retryable; unfreezes nothing. */
create or replace function public.fail_gift_card_refund(p_refund_id uuid, p_category text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_rows integer;
begin
  update public.gift_card_refunds
  set state = case when attempts >= 10 then 'review_required' else 'provider_refund_failed' end,
      failure_category = left(coalesce(p_category, 'unknown'), 60),
      review_reason = case when attempts >= 10 then 'gift_card_refund_reconciliation_exhausted' else review_reason end
  where id = p_refund_id and state = 'provider_refund_pending';

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.fail_gift_card_refund(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_gift_card_refund(uuid, text) to service_role;

-- ===========================================================================
-- 5. Disputes
-- ===========================================================================

/**
 * A dispute was opened against a gift-card purchase.
 *
 * Unclaimed: invalidate the credential so nobody can claim value that is being
 * clawed back. Claimed: freeze what REMAINS. Already-spent value is not clawed
 * back here — that would revoke products the recipient is using, which is an
 * owner decision, not something a webhook should do. The downstream orders are
 * linked for review instead.
 *
 * Idempotent: replaying the event changes nothing and creates no second review.
 */
create or replace function public.record_gift_card_dispute(
  p_gift_card_id uuid,
  p_provider_event_id text,
  p_disputed_cents bigint default 0
)
returns table(outcome text, frozen_cents bigint, downstream_orders integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.gift_cards%rowtype;
  v_lot public.store_credit_lots%rowtype;
  v_orders integer := 0;
  v_frozen bigint := 0;
begin
  select * into v_card from public.gift_cards where id = p_gift_card_id for update;
  if not found then
    outcome := 'gift_card_not_found'; frozen_cents := 0; downstream_orders := 0;
    return next; return;
  end if;

  if v_card.disputed_at is not null and v_card.dispute_closed_at is null then
    outcome := 'already_disputed'; frozen_cents := 0; downstream_orders := 0;
    return next; return;
  end if;

  update public.gift_cards
  set disputed_at = now(), dispute_status = 'open', dispute_closed_at = null
  where id = p_gift_card_id;

  if v_card.claimed_by is null then
    -- Nobody has the value yet, and nobody is getting it.
    update public.gift_card_claim_credentials
    set state = 'invalidated', invalidated_at = now(), invalidated_reason = 'disputed'
    where gift_card_id = p_gift_card_id and state = 'active';
    outcome := 'unclaimed_blocked';
  else
    select * into v_lot from public.store_credit_lots where gift_card_id = p_gift_card_id for update;
    if found then
      update public.store_credit_lots set frozen_cents = remaining_cents where id = v_lot.id;
      v_frozen := v_lot.remaining_cents;
      select count(distinct order_id) into v_orders
      from public.store_credit_lot_allocations where lot_id = v_lot.id and state = 'consumed';
    end if;
    outcome := 'claimed_frozen';
  end if;

  insert into public.payment_reviews (provider, provider_event_id, event_type, order_id, reason, detail)
  values (
    'stripe', p_provider_event_id, 'gift_card_dispute', v_card.purchaser_order_id,
    case when v_orders > 0 then 'gift_card_dispute_downstream_spend' else 'gift_card_dispute' end,
    jsonb_build_object(
      'priority', 'high',
      'gift_card_id', p_gift_card_id,
      'claimed', v_card.claimed_by is not null,
      'frozen_cents', v_frozen,
      'downstream_orders', v_orders,
      'disputed_cents', coalesce(p_disputed_cents, 0)
    )
  )
  on conflict (provider, provider_event_id) do nothing;

  frozen_cents := v_frozen; downstream_orders := v_orders;
  return next;
end;
$$;

revoke all on function public.record_gift_card_dispute(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.record_gift_card_dispute(uuid, text, bigint) to service_role;

/**
 * The dispute closed.
 *
 * WON  -> unfreeze what remains, exactly once. Never recreates consumed value
 *         and never creates a second lot.
 * LOST -> the freeze stays and a human owns it. No negative balance is created
 *         and no unrelated product is revoked automatically.
 * Anything else -> fail closed: stay frozen, stay in review.
 */
create or replace function public.resolve_gift_card_dispute(
  p_gift_card_id uuid,
  p_provider_event_id text,
  p_outcome text
)
returns table(outcome text, unfrozen_cents bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.gift_cards%rowtype;
  v_lot public.store_credit_lots%rowtype;
  v_unfrozen bigint := 0;
  v_result text;
begin
  select * into v_card from public.gift_cards where id = p_gift_card_id for update;
  if not found then
    outcome := 'gift_card_not_found'; unfrozen_cents := 0; return next; return;
  end if;

  if v_card.dispute_closed_at is not null then
    outcome := 'already_closed'; unfrozen_cents := 0; return next; return;
  end if;

  select * into v_lot from public.store_credit_lots where gift_card_id = p_gift_card_id for update;

  if p_outcome = 'won' then
    if v_lot.id is not null then
      v_unfrozen := v_lot.frozen_cents;
      update public.store_credit_lots set frozen_cents = 0 where id = v_lot.id;
    end if;
    -- An unclaimed card whose dispute we won is claimable again only if a
    -- credential is re-issued by staff; this does not silently revive one.
    update public.gift_cards
    set dispute_status = 'won', dispute_closed_at = now(), frozen_at = null, frozen_reason = null
    where id = p_gift_card_id;
    v_result := 'won_unfrozen';

  elsif p_outcome = 'lost' then
    update public.gift_cards
    set dispute_status = 'lost', dispute_closed_at = now(),
        frozen_at = coalesce(frozen_at, now()),
        frozen_reason = coalesce(frozen_reason, 'dispute_lost')
    where id = p_gift_card_id;
    v_result := 'lost_frozen';

  else
    -- Unknown closure. Do not guess: stay frozen, stay in review.
    v_result := 'unknown_held';
  end if;

  insert into public.payment_reviews (provider, provider_event_id, event_type, order_id, reason, detail)
  values (
    'stripe', p_provider_event_id, 'gift_card_dispute_closed', v_card.purchaser_order_id,
    'gift_card_dispute_' || coalesce(p_outcome, 'unknown'),
    jsonb_build_object(
      'priority', case when p_outcome = 'won' then 'normal' else 'high' end,
      'gift_card_id', p_gift_card_id,
      'unfrozen_cents', v_unfrozen,
      'requires_review', p_outcome <> 'won'
    )
  )
  on conflict (provider, provider_event_id) do nothing;

  outcome := v_result; unfrozen_cents := v_unfrozen;
  return next;
end;
$$;

revoke all on function public.resolve_gift_card_dispute(uuid, text, text) from public, anon, authenticated;
grant execute on function public.resolve_gift_card_dispute(uuid, text, text) to service_role;

/** The gift card a purchase order issued, if any. Routing helper for webhooks. */
create or replace function public.gift_card_for_order(p_order_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.gift_cards where purchaser_order_id = p_order_id limit 1
$$;

revoke all on function public.gift_card_for_order(uuid) from public, anon, authenticated;
grant execute on function public.gift_card_for_order(uuid) to service_role;
