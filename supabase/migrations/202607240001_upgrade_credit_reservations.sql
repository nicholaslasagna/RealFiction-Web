-- Upgrade-credit RESERVATION lifecycle, item-level identity, and refund
-- dependency. Corrects 202607230001.
--
-- WHAT WAS WRONG
-- ==============
-- 1. Credit was CONSUMED when the pending order was created. A pending order is
--    not a purchase: an abandoned checkout, a Stripe creation failure, an
--    expired session, or a failed async payment permanently stranded the
--    customer's credit with no path back.
-- 2. Identity was the source ORDER. An order can hold several items, so an
--    order-level key cannot say WHICH purchase funded the upgrade, and a
--    multi-item order could be mis-credited with the whole order's value.
-- 3. Refunding the source RealVIP after using it as credit was unhandled — buy
--    VIP, upgrade cheaply, refund VIP, keep RealSupporter at an unearned
--    discount.
--
-- WHAT THIS DOES
-- ==============
-- Credit is RESERVED at checkout and CONSUMED only inside the transaction that
-- successfully fulfils the order. Every failure path releases. Consumption is
-- keyed to a source ORDER ITEM, and a consumed source cannot be silently
-- refunded.

-- ---------------------------------------------------------------------------
-- 1. Retire the unsafe order-level table
-- ---------------------------------------------------------------------------
-- Never shipped to production (202607230001 is unapplied), so there is no data
-- to migrate. Dropping the function too: leaving it would keep a callable path
-- that consumes credit outside fulfilment.
drop function if exists public.consume_upgrade_credit(uuid, uuid, text, text, bigint);
drop table if exists public.upgrade_credits_consumed;

-- ---------------------------------------------------------------------------
-- 2. Reservation ledger (item-level identity + explicit lifecycle)
-- ---------------------------------------------------------------------------
create table if not exists public.upgrade_credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- ITEM-level identity. An order may contain several products; only the line
  -- that actually bought RealVIP may fund an upgrade.
  source_order_item_id uuid not null references public.order_items(id) on delete cascade,
  source_order_id uuid not null references public.orders(id) on delete cascade,

  from_slug text not null,
  to_slug text not null,
  -- Authoritative discount, frozen at reservation time so a later price change
  -- cannot alter an in-flight checkout.
  credit_cents bigint not null check (credit_cents >= 0),

  -- What this reservation is held for.
  order_id uuid references public.orders(id) on delete set null,
  checkout_attempt_id uuid,

  state text not null default 'reserved'
    check (state in ('reserved', 'consumed', 'released', 'invalidated')),
  released_reason text,

  reserved_at timestamptz not null default now(),
  -- A reservation that outlives its checkout attempt is swept back to
  -- available, so an abandoned tab cannot park credit forever.
  expires_at timestamptz not null default now() + interval '2 hours',
  consumed_at timestamptz,
  released_at timestamptz
);

-- At most ONE live reservation per source item: two concurrent checkouts cannot
-- both hold the same credit.
create unique index if not exists upgrade_reservations_one_active_idx
on public.upgrade_credit_reservations(source_order_item_id)
where state = 'reserved';

-- A source item may fund at most ONE upgrade, ever.
create unique index if not exists upgrade_reservations_one_consumed_idx
on public.upgrade_credit_reservations(source_order_item_id)
where state = 'consumed';

-- One reservation per pending order, so a retry cannot stack reservations.
create unique index if not exists upgrade_reservations_one_per_order_idx
on public.upgrade_credit_reservations(order_id)
where order_id is not null and state in ('reserved', 'consumed');

create index if not exists upgrade_reservations_sweep_idx
on public.upgrade_credit_reservations(expires_at)
where state = 'reserved';

alter table public.upgrade_credit_reservations enable row level security;
-- No policies: service-role only. Purchase history is never client-readable.

-- ---------------------------------------------------------------------------
-- 3. Eligible source items
-- ---------------------------------------------------------------------------
/**
 * Source order items that may fund an upgrade, with the credit each is worth.
 *
 * Credit is the EXTERNALLY PAID share of that line — the money actually taken
 * through a payment provider, allocated proportionally when an order mixed
 * store credit with a card. A line bought entirely with store credit is worth
 * zero and is therefore excluded: refunding store credit to fund a discount
 * would let value be spent twice. (Flagged for owner approval.)
 *
 * Deliberately EXCLUDED, each because the policy is unresolved or the source is
 * not a genuine paid purchase:
 *   * gifts (bought for someone else, or received)
 *   * refunded / chargeback / revoked source orders
 *   * manually granted entitlements (no order item exists at all)
 *   * inherited RealVIP from RealSupporter (metadata source = 'inclusion')
 *   * legacy fixed-term RealVIP (expiring access is not a permanent asset)
 */
create or replace function public.eligible_upgrade_sources(
  p_user_id uuid,
  p_from_slug text
)
returns table(
  order_item_id uuid,
  order_id uuid,
  credit_cents bigint,
  purchased_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    oi.id,
    o.id,
    -- External share of this line, floored at 0. When an order was fully paid
    -- externally this is simply the line total.
    greatest(
      0,
      floor(
        oi.total_cents::numeric
        * (case when o.total_cents > 0
                then least(1.0, coalesce(o.payment_due_cents, o.total_cents)::numeric / o.total_cents::numeric)
                else 0 end)
      )::bigint
    ) as credit_cents,
    coalesce(o.paid_at, o.created_at)
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.products p on p.id = oi.product_id
  where o.user_id = p_user_id
    and p.slug = p_from_slug
    -- Settled, not reversed.
    and o.status in ('paid', 'fulfilled')
    -- Not a gift in either direction.
    and o.gifted_to_minecraft_username is null
    -- Never already reserved or spent.
    and not exists (
      select 1 from public.upgrade_credit_reservations r
      where r.source_order_item_id = oi.id
        and r.state in ('reserved', 'consumed')
    )
$$;

revoke all on function public.eligible_upgrade_sources(uuid, text) from public, anon, authenticated;
grant execute on function public.eligible_upgrade_sources(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Quote (read-only, no side effects)
-- ---------------------------------------------------------------------------
-- The OUT-parameter shape changes (source_order_id -> source_order_item_id +
-- source_order_id), and Postgres cannot `create or replace` across a different
-- row type. Dropping first also removes the old order-level signature so no
-- caller can reach it.
drop function if exists public.compute_upgrade_price(uuid, text);

create or replace function public.compute_upgrade_price(
  p_user_id uuid,
  p_to_slug text
)
returns table(
  eligible boolean,
  reason text,
  target_price_cents bigint,
  credit_cents bigint,
  upgrade_price_cents bigint,
  source_order_item_id uuid,
  source_order_id uuid,
  from_slug text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from text;
  v_target bigint;
  v_src record;
begin
  select p.price_cents into v_target
  from public.products p where p.slug = p_to_slug and p.active;

  if v_target is null then
    eligible := false; reason := 'upgrade_target_unavailable';
    target_price_cents := 0; credit_cents := 0; upgrade_price_cents := 0;
    source_order_item_id := null; source_order_id := null; from_slug := null;
    return next; return;
  end if;

  if exists (
    select 1 from public.entitlements e
    where e.user_id = p_user_id
      and e.entitlement_key = 'product:' || p_to_slug
      and e.status = 'active'
      and (e.expires_at is null or e.expires_at > now())
  ) then
    eligible := false; reason := 'upgrade_target_already_owned';
    target_price_cents := v_target; credit_cents := 0; upgrade_price_cents := v_target;
    source_order_item_id := null; source_order_id := null; from_slug := null;
    return next; return;
  end if;

  select u.from_slug into v_from
  from public.product_upgrades u where u.to_slug = p_to_slug limit 1;

  if v_from is null then
    eligible := false; reason := 'no_upgrade_path';
    target_price_cents := v_target; credit_cents := 0; upgrade_price_cents := v_target;
    source_order_item_id := null; source_order_id := null; from_slug := null;
    return next; return;
  end if;

  -- Most valuable eligible line, oldest first on ties.
  -- Aliased: the OUT parameters of this function share names with the columns
  -- returned by eligible_upgrade_sources, which is otherwise ambiguous.
  select * into v_src
  from public.eligible_upgrade_sources(p_user_id, v_from) src
  where src.credit_cents > 0
  order by src.credit_cents desc, src.purchased_at asc
  limit 1;

  if v_src.order_item_id is null then
    eligible := false; reason := 'upgrade_credit_unavailable';
    target_price_cents := v_target; credit_cents := 0; upgrade_price_cents := v_target;
    source_order_item_id := null; source_order_id := null; from_slug := v_from;
    return next; return;
  end if;

  eligible := true;
  reason := 'ok';
  target_price_cents := v_target;
  credit_cents := v_src.credit_cents;
  -- Never negative, never a payout.
  upgrade_price_cents := greatest(0, v_target - v_src.credit_cents);
  source_order_item_id := v_src.order_item_id;
  source_order_id := v_src.order_id;
  from_slug := v_from;
  return next;
end;
$$;

revoke all on function public.compute_upgrade_price(uuid, text) from public, anon, authenticated;
grant execute on function public.compute_upgrade_price(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. RESERVE (at checkout)
-- ---------------------------------------------------------------------------
/**
 * Reserves a credit for one pending order. Does NOT consume it.
 *
 * Selects and locks the source line in one statement, so two concurrent
 * checkouts cannot both reserve it — the partial unique index is the final
 * arbiter and the loser gets `upgrade_credit_already_reserved`.
 *
 * Re-reserving for the SAME order is idempotent, so a retried checkout attempt
 * does not stack reservations.
 */
create or replace function public.reserve_upgrade_credit(
  p_user_id uuid,
  p_to_slug text,
  p_order_id uuid,
  p_checkout_attempt_id uuid default null,
  p_ttl_seconds integer default 7200
)
returns table(reserved boolean, reason text, reservation_id uuid, credit_cents bigint, upgrade_price_cents bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote record;
  v_existing public.upgrade_credit_reservations%rowtype;
  v_id uuid;
begin
  -- Sweep expired holds first so abandoned tabs never park credit.
  perform public.expire_stale_upgrade_reservations();

  -- Idempotent replay for the same order.
  select * into v_existing
  from public.upgrade_credit_reservations
  where order_id = p_order_id and state = 'reserved';

  if found then
    reserved := true; reason := 'already_reserved_for_order';
    reservation_id := v_existing.id; credit_cents := v_existing.credit_cents;
    upgrade_price_cents := greatest(
      0,
      (select price_cents from public.products where slug = v_existing.to_slug) - v_existing.credit_cents
    );
    return next; return;
  end if;

  select * into v_quote from public.compute_upgrade_price(p_user_id, p_to_slug);

  if not v_quote.eligible then
    reserved := false; reason := v_quote.reason;
    reservation_id := null; credit_cents := 0; upgrade_price_cents := v_quote.target_price_cents;
    return next; return;
  end if;

  begin
    insert into public.upgrade_credit_reservations (
      user_id, source_order_item_id, source_order_id, from_slug, to_slug,
      credit_cents, order_id, checkout_attempt_id, state, expires_at
    )
    values (
      p_user_id, v_quote.source_order_item_id, v_quote.source_order_id,
      v_quote.from_slug, p_to_slug, v_quote.credit_cents, p_order_id,
      p_checkout_attempt_id, 'reserved',
      now() + make_interval(secs => greatest(300, p_ttl_seconds))
    )
    returning id into v_id;
  exception
    when unique_violation then
      -- Another checkout won the race for this source line.
      reserved := false; reason := 'upgrade_credit_already_reserved';
      reservation_id := null; credit_cents := 0; upgrade_price_cents := v_quote.target_price_cents;
      return next; return;
  end;

  reserved := true; reason := 'ok';
  reservation_id := v_id; credit_cents := v_quote.credit_cents;
  upgrade_price_cents := v_quote.upgrade_price_cents;
  return next;
end;
$$;

revoke all on function public.reserve_upgrade_credit(uuid, text, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_upgrade_credit(uuid, text, uuid, uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 6. RELEASE (every failure path)
-- ---------------------------------------------------------------------------
/** Returns a reservation to available. Idempotent. */
create or replace function public.release_upgrade_credit(
  p_order_id uuid,
  p_reason text default 'released'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update public.upgrade_credit_reservations
  set state = 'released', released_at = now(), released_reason = p_reason
  where order_id = p_order_id and state = 'reserved';

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.release_upgrade_credit(uuid, text) from public, anon, authenticated;
grant execute on function public.release_upgrade_credit(uuid, text) to service_role;

/** Sweeps holds whose checkout never completed. */
create or replace function public.expire_stale_upgrade_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update public.upgrade_credit_reservations
  set state = 'released', released_at = now(), released_reason = 'expired'
  where state = 'reserved' and expires_at <= now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.expire_stale_upgrade_reservations() from public, anon, authenticated;
grant execute on function public.expire_stale_upgrade_reservations() to service_role;

-- ---------------------------------------------------------------------------
-- 7. CONSUME (only inside successful fulfilment)
-- ---------------------------------------------------------------------------
/**
 * Marks the reservation consumed. Called ONLY from inside a fulfilment
 * transaction, so if fulfilment rolls back the consumption rolls back with it,
 * and a replayed webhook cannot consume twice (the row is no longer 'reserved').
 */
create or replace function public.consume_upgrade_credit_for_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update public.upgrade_credit_reservations
  set state = 'consumed', consumed_at = now()
  where order_id = p_order_id and state = 'reserved';

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.consume_upgrade_credit_for_order(uuid) from public, anon, authenticated;
grant execute on function public.consume_upgrade_credit_for_order(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Refund dependency
-- ---------------------------------------------------------------------------
/**
 * Does refunding this order undermine an upgrade that was already granted?
 *
 * Buy VIP -> upgrade cheaply -> refund VIP would keep RealSupporter at an
 * unearned discount. Rather than silently allowing or silently blocking, the
 * webhook records a manual review: the economics are a business decision, not a
 * migration's to make.
 */
create or replace function public.upgrade_dependency_for_order(p_order_id uuid)
returns table(has_dependency boolean, upgrade_order_id uuid, credit_cents bigint, to_slug text)
language sql
stable
security definer
set search_path = public
as $$
  select true, r.order_id, r.credit_cents, r.to_slug
  from public.upgrade_credit_reservations r
  where r.source_order_id = p_order_id and r.state = 'consumed'
  limit 1
$$;

revoke all on function public.upgrade_dependency_for_order(uuid) from public, anon, authenticated;
grant execute on function public.upgrade_dependency_for_order(uuid) to service_role;

/**
 * The upgraded order was itself refunded/revoked. The consumed credit is
 * marked invalidated — NOT returned to available: whether the customer may
 * re-use it is an owner policy decision, and silently handing it back could
 * fund a second discounted upgrade.
 */
create or replace function public.invalidate_upgrade_credit_for_order(p_order_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update public.upgrade_credit_reservations
  set state = 'invalidated', released_reason = p_reason, released_at = now()
  where order_id = p_order_id and state = 'consumed';

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.invalidate_upgrade_credit_for_order(uuid, text) from public, anon, authenticated;
grant execute on function public.invalidate_upgrade_credit_for_order(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Consume INSIDE fulfilment (the whole point)
-- ---------------------------------------------------------------------------
-- Both fulfilment entry points are re-created with ONE addition: they consume
-- the order's upgrade reservation in the SAME transaction that grants
-- entitlements, queues rewards, reaches terminal status, and writes the email
-- outbox row. If any of that rolls back, the credit rolls back to reserved and
-- the customer can retry. A replayed webhook finds no 'reserved' row and
-- consumes nothing.

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

  -- Payment is authoritatively successful and fulfilment succeeded: spend it.
  perform public.consume_upgrade_credit_for_order(p_order_id);

  v_queued := public.enqueue_order_confirmation_delivery(p_order_id);

  already_fulfilled := coalesce(v_fulfilled, false);
  email_queued := coalesce(v_queued, false);
  return next;
end;
$$;

revoke all on function public.fulfill_paid_order_with_outbox(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.fulfill_paid_order_with_outbox(uuid, text, text, text) to service_role;

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

  select coalesce(sum(delta_cents), 0) into v_available
  from public.store_credit_ledger where user_id = p_user_id;

  -- Fails closed: no ledger write, no order mutation, no entitlement, and the
  -- upgrade reservation stays reserved for a retry.
  if v_available < v_order.total_cents then
    return false;
  end if;

  insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
  values (p_user_id, -v_order.total_cents, 'store_purchase_spend', p_order_id::text,
          'store_credit_spend:' || p_order_id::text, 'Store credit checkout')
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  update public.orders
  set store_credit_applied_cents = v_order.total_cents,
      payment_due_cents = 0,
      provider = 'gift_card',
      provider_payment_id = 'store_credit',
      paid_at = coalesce(paid_at, now())
  where id = p_order_id;

  perform public.fulfill_paid_order(p_order_id);
  perform public.issue_gift_cards_for_order(p_order_id);

  -- Same transaction as the spend and the grant.
  perform public.consume_upgrade_credit_for_order(p_order_id);
  perform public.enqueue_order_confirmation_delivery(p_order_id);

  return true;
end;
$$;

revoke all on function public.complete_store_credit_only_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_store_credit_only_order(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 10. Release on terminal-unpaid, invalidate on reversal
-- ---------------------------------------------------------------------------
-- A pending order that dies (async payment failed, session expired, cancelled)
-- must hand its credit back. A PAID order that is later reversed must NOT hand
-- it back automatically — that is an owner policy decision.
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

  -- Never paid -> the reservation goes back to available.
  if new.status = 'cancelled' and old.status is distinct from new.status then
    perform public.release_upgrade_credit(new.id, 'order_cancelled');
  end if;

  -- Paid then reversed -> the consumed credit is invalidated, not returned.
  if new.status in ('refunded', 'chargeback') and old.status is distinct from new.status then
    perform public.invalidate_upgrade_credit_for_order(new.id, 'order_' || new.status::text);
  end if;

  return new;
end;
$$;

drop trigger if exists orders_close_checkout_attempt on public.orders;
create trigger orders_close_checkout_attempt
after update of status on public.orders
for each row
execute function public.close_checkout_attempt_on_terminal_order();
