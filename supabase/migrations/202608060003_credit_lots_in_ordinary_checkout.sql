-- Wire gift-origin credit lots into the EXISTING store-credit checkout path.
--
-- THE MODEL, AND WHY IT IS NOT TWO BALANCES
-- =========================================
-- `store_credit_ledger` is, and remains, the single authority on how much
-- credit an account has. Reserving writes a negative entry, so the balance
-- drops immediately; releasing writes a compensating positive entry;
-- finalising converts the reserve into a spend. Every existing source — refund
-- credit, manual grants, promotional credit — works this way and is untouched
-- by this migration.
--
-- `store_credit_lots` is NOT a second balance. It is a provenance OVERLAY over
-- the gift-origin subset of that ledger, and it answers a question the ledger
-- cannot: which gift card did this particular dollar come from? That matters
-- because gift-origin value carries obligations promotional credit does not
-- (no expiry, no fees, cash redemption where required by law), so a refund has
-- to restore it to the lot it came from and a dispute has to freeze it
-- specifically.
--
-- The two are kept consistent by construction: lot allocation is always
-- BOUNDED BY the ledger reservation for the same order, and happens in the same
-- transaction. The ledger decides how much; the lots record where from.
--
-- THE HONEST LIMITATION
-- =====================
-- Credit that predates gift cards has no lot. That is deliberate: fabricating
-- lots for it would invent provenance that does not exist, and inventing
-- gift-card provenance for promotional credit would turn it into a
-- cash-redeemable liability. So an account can hold both lotted and unlotted
-- credit, and the gift-origin portion is allocated first. See the report.

-- ---------------------------------------------------------------------------
-- 1. Deterministic lot order
-- ---------------------------------------------------------------------------
-- `created_at` ties on a fast test or a batch claim, and `id` is a random uuid,
-- so ordering by either alone is non-deterministic. A monotonic sequence makes
-- allocation reproducible, which is what lets a test assert WHICH lot was spent.
alter table public.store_credit_lots
  add column if not exists lot_seq bigserial;

create index if not exists store_credit_lots_alloc_idx
on public.store_credit_lots(user_id, lot_seq)
where remaining_cents > 0;

/**
 * Gift-origin credit this account can actually spend right now.
 *
 * Excludes frozen value: a disputed card's remainder stops being spendable the
 * moment the dispute opens, without the record of it disappearing.
 */
create or replace function public.gift_origin_available(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(greatest(0, l.remaining_cents - l.frozen_cents)), 0)::bigint
  from public.store_credit_lots l
  where l.user_id = p_user_id and l.source = 'gift_card'
$$;

revoke all on function public.gift_origin_available(uuid) from public, anon, authenticated;
grant execute on function public.gift_origin_available(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Reserve: ledger first, then record provenance for the gift-origin share
-- ---------------------------------------------------------------------------
/**
 * Unchanged contract and unchanged ledger behaviour. ONE addition: after the
 * ledger reservation succeeds, the gift-origin share of that reservation is
 * allocated against specific lots, oldest first.
 *
 * `reserve_credit_lots` is bounded by what the ledger already approved, so it
 * can never reserve more than the account has, and an account with no gift
 * cards simply allocates nothing and behaves exactly as before.
 */
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
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('storecredit:' || p_user_id::text));

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

  if v_available < p_amount_cents then
    return false;
  end if;

  insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
  values (p_user_id, -p_amount_cents, 'store_credit_reserve', p_order_id::text,
          'store_credit_reserve:' || p_order_id::text, 'Reserved for checkout');

  update public.orders
  set store_credit_applied_cents = p_amount_cents,
      payment_due_cents = total_cents - p_amount_cents
  where id = p_order_id;

  -- PROVENANCE. Bounded by the amount the ledger just approved. Returns less
  -- than requested when the account holds a mix of gift-origin and older
  -- unlotted credit — which is correct: only the gift-origin part has a lot.
  perform public.reserve_credit_lots(p_user_id, p_order_id, p_amount_cents::bigint);

  return true;
end;
$$;

revoke all on function public.reserve_store_credit_for_order(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_store_credit_for_order(uuid, uuid, integer) to service_role;

-- Deterministic allocation, and frozen value excluded.
create or replace function public.reserve_credit_lots(
  p_user_id uuid,
  p_order_id uuid,
  p_amount_cents bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining bigint := greatest(0, coalesce(p_amount_cents, 0));
  v_taken bigint := 0;
  v_lot record;
  v_take bigint;
begin
  if v_remaining = 0 then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtext('creditlots:' || p_user_id::text));

  select coalesce(sum(amount_cents), 0) into v_taken
  from public.store_credit_lot_allocations
  where order_id = p_order_id and state in ('reserved', 'consumed');

  if v_taken > 0 then
    return v_taken;
  end if;

  for v_lot in
    select id, greatest(0, remaining_cents - frozen_cents) as available
    from public.store_credit_lots
    where user_id = p_user_id
      and remaining_cents > frozen_cents
    -- lot_seq, not created_at or id: reproducible, so a test can assert which
    -- lot funded which purchase.
    order by lot_seq
    for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_lot.available, v_remaining);
    if v_take <= 0 then
      continue;
    end if;

    insert into public.store_credit_lot_allocations (lot_id, order_id, amount_cents, state)
    values (v_lot.id, p_order_id, v_take, 'reserved');

    update public.store_credit_lots
    set remaining_cents = remaining_cents - v_take
    where id = v_lot.id;

    v_remaining := v_remaining - v_take;
    v_taken := v_taken + v_take;
  end loop;

  return v_taken;
end;
$$;

revoke all on function public.reserve_credit_lots(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.reserve_credit_lots(uuid, uuid, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Finalise and release follow the ledger
-- ---------------------------------------------------------------------------
/**
 * Converts a reservation into a spend. Unchanged ledger behaviour; the lot
 * allocations for the same order are consumed in the SAME transaction, so the
 * provenance record can never drift from the money.
 */
drop function if exists public.finalize_store_credit_for_order(uuid);

create or replace function public.finalize_store_credit_for_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return false;
  end if;

  -- The reserve entry already removed the value from the balance. Finalising
  -- rewrites it as a purchase spend so history reads correctly; the net effect
  -- on the balance is zero, which is why this is safe to replay.
  update public.store_credit_ledger
  set source = 'store_purchase_spend',
      note = 'Store credit checkout'
  where idempotency_key = 'store_credit_reserve:' || p_order_id::text
    and source = 'store_credit_reserve';

  perform public.consume_credit_lots(p_order_id);

  return true;
end;
$$;

revoke all on function public.finalize_store_credit_for_order(uuid) from public, anon, authenticated;
grant execute on function public.finalize_store_credit_for_order(uuid) to service_role;

/**
 * Returns a reservation to the balance AND to its source lots.
 *
 * Idempotent. Deliberately unchanged in when it may be called: the existing
 * evidence-based policy still applies, and a session-backed reservation is
 * never released on a timestamp alone.
 */
drop function if exists public.release_store_credit_for_order(uuid);

create or replace function public.release_store_credit_for_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reserve public.store_credit_ledger%rowtype;
begin
  select * into v_reserve from public.store_credit_ledger
  where idempotency_key = 'store_credit_reserve:' || p_order_id::text
    and source = 'store_credit_reserve';

  if not found then
    -- Nothing reserved, or already finalised into a spend. Either way there is
    -- nothing to hand back.
    return false;
  end if;

  -- Already released. The compensating entry below is idempotent on its key, so
  -- a repeat cannot mint credit — but it must not REPORT that it released
  -- something either, or a caller retrying cleanup would log a release that
  -- never happened.
  if exists (
    select 1 from public.store_credit_ledger
    where idempotency_key = 'store_credit_release:' || p_order_id::text
  ) then
    return false;
  end if;

  insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
  values (v_reserve.user_id, -v_reserve.delta_cents, 'store_credit_release', p_order_id::text,
          'store_credit_release:' || p_order_id::text, 'Checkout released')
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  perform public.release_credit_lots(p_order_id);

  return true;
end;
$$;

revoke all on function public.release_store_credit_for_order(uuid) from public, anon, authenticated;
grant execute on function public.release_store_credit_for_order(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Store-credit-only completion consumes the same allocations
-- ---------------------------------------------------------------------------
create or replace function public.complete_store_credit_only_order(p_order_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_available bigint;
begin
  perform pg_advisory_xact_lock(hashtext('storecredit:' || p_user_id::text));

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return false; end if;
  if v_order.user_id is distinct from p_user_id then return false; end if;

  if v_order.status in ('paid', 'fulfilled') then
    perform public.enqueue_order_confirmation_delivery(p_order_id);
    return true;
  end if;
  if v_order.status <> 'pending' then return false; end if;

  -- Stored value may never buy stored value.
  if exists (
    select 1 from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.category = 'gift_cards'
  ) then
    return false;
  end if;

  select coalesce(sum(delta_cents), 0) into v_available
  from public.store_credit_ledger where user_id = p_user_id;

  -- A partial-credit order that already reserved through checkout has had that
  -- amount removed from the balance; add it back so it is not rejected for
  -- money it is already holding.
  v_available := v_available + coalesce((
    select -delta_cents from public.store_credit_ledger
    where idempotency_key = 'store_credit_reserve:' || p_order_id::text
      and source = 'store_credit_reserve'
  ), 0);

  if v_available < v_order.total_cents then
    return false;
  end if;

  -- An order can reach here by two routes: created fully-credit at checkout
  -- (no reservation), or reserved at checkout and then discovered to need no
  -- external payment. Only the second has already debited the ledger, so the
  -- reserve is compensated before the spend is written — otherwise the account
  -- is charged twice for one order.
  insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
  select p_user_id, v_order.total_cents, 'store_credit_release', p_order_id::text,
         'store_credit_release:' || p_order_id::text, 'Reserve converted to spend'
  where exists (
    select 1 from public.store_credit_ledger
    where idempotency_key = 'store_credit_reserve:' || p_order_id::text
      and source = 'store_credit_reserve'
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  -- Ledger spend, exactly as before this migration: one `store_purchase_spend`
  -- entry keyed on the order. Existing suites assert this shape and it must not
  -- change just because provenance was added.
  insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
  values (p_user_id, -v_order.total_cents, 'store_purchase_spend', p_order_id::text,
          'store_credit_spend:' || p_order_id::text, 'Store credit checkout')
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  -- PROVENANCE ONLY. Allocates the gift-origin share against specific lots
  -- without touching the ledger, then spends it in this same transaction.
  perform public.reserve_credit_lots(p_user_id, p_order_id, v_order.total_cents::bigint);

  update public.orders
  set store_credit_applied_cents = v_order.total_cents,
      payment_due_cents = 0,
      provider = 'gift_card',
      provider_payment_id = 'store_credit',
      paid_at = coalesce(paid_at, now())
  where id = p_order_id;

  -- Entitlement, reward, terminal state, credit spend, and provenance: one
  -- transaction. A replay finds the order terminal and returns above.
  perform public.fulfill_paid_order(p_order_id);
  perform public.consume_credit_lots(p_order_id);
  perform public.enqueue_order_confirmation_delivery(p_order_id);

  return true;
end;
$$;

revoke all on function public.complete_store_credit_only_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_store_credit_only_order(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Mixed payment: consume on verified fulfilment, never before
-- ---------------------------------------------------------------------------
create or replace function public.fulfill_paid_order_with_outbox(
  p_order_id uuid,
  p_payment_intent_id text default null,
  p_charge_id text default null,
  p_receipt_url text default null
)
returns table(already_fulfilled boolean, email_queued boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fulfilled boolean;
  v_queued boolean;
begin
  update public.orders
  set provider_payment_id = coalesce(p_payment_intent_id, provider_payment_id),
      stripe_charge_id = coalesce(p_charge_id, stripe_charge_id),
      stripe_receipt_url = coalesce(p_receipt_url, stripe_receipt_url),
      paid_at = coalesce(paid_at, now())
  where id = p_order_id;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  select f.already_fulfilled into v_fulfilled from public.fulfill_paid_order(p_order_id) f;

  -- The payment is authoritatively successful, so the credit reserved at
  -- checkout is spent NOW — in the same transaction as the grant, never at
  -- checkout time when nothing had been paid yet.
  perform public.finalize_store_credit_for_order(p_order_id);

  v_queued := public.enqueue_order_confirmation_delivery(p_order_id);

  already_fulfilled := coalesce(v_fulfilled, false);
  email_queued := coalesce(v_queued, false);
  return next;
end;
$$;

revoke all on function public.fulfill_paid_order_with_outbox(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.fulfill_paid_order_with_outbox(uuid, text, text, text) to service_role;
