-- Phase 20: Spend store credit at checkout.
--
-- Builds on the store_credit_ledger (migration 0028) and gift card lifecycle
-- (migration 0030). Adds order columns + ledger-based reserve/release/spend
-- RPCs so a user can pay for part or all of a cart with redeemed gift-card
-- credit, without ever double-spending.
--
-- Ledger model (append-only, idempotent by key):
--   full coverage    : -total  store_purchase_spend   store_credit_spend:<order>
--   partial reserve  : -amount  store_credit_reserve   store_credit_reserve:<order>
--   …on payment      : the reserve row is RELABELLED to store_purchase_spend
--   …on cancel/expire: +amount  store_credit_release   store_credit_release:<order>
-- A per-user advisory lock serialises balance reads + debits so concurrent
-- checkouts of different orders can't over-spend the same balance.

set search_path = public;

-- ---------------------------------------------------------------------------
-- Order columns for credit application.
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists store_credit_applied_cents integer not null default 0;
alter table public.orders add column if not exists payment_due_cents integer;

-- ---------------------------------------------------------------------------
-- Extend the ledger source vocabulary with reserve/release.
-- ---------------------------------------------------------------------------
alter table public.store_credit_ledger drop constraint if exists store_credit_ledger_source_check;
alter table public.store_credit_ledger
  add constraint store_credit_ledger_source_check
  check (source in (
    'gift_card_redemption', 'store_purchase_spend', 'refund', 'manual_grant', 'manual_revoke',
    'store_credit_reserve', 'store_credit_release'
  ));

-- ---------------------------------------------------------------------------
-- Reserve credit for a pending (partial-credit) order. Idempotent; returns
-- false if the user no longer has enough available balance.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_store_credit_for_order(p_order_id uuid, p_user_id uuid, p_amount_cents integer)
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

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Release a reserved (not-yet-finalised) credit hold on cancel/expiry. Returns
-- the released amount (0 if nothing to release or already finalised).
-- ---------------------------------------------------------------------------
create or replace function public.release_store_credit_for_order(p_order_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_amount bigint;
begin
  -- Only an un-finalised reserve (still labelled store_credit_reserve) is releasable.
  select user_id, -delta_cents into v_user, v_amount
  from public.store_credit_ledger
  where idempotency_key = 'store_credit_reserve:' || p_order_id::text
    and source = 'store_credit_reserve';

  if not found then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtext('storecredit:' || v_user::text));

  if exists (
    select 1 from public.store_credit_ledger
    where idempotency_key = 'store_credit_release:' || p_order_id::text
  ) then
    return 0;
  end if;

  insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
  values (v_user, v_amount, 'store_credit_release', p_order_id::text,
          'store_credit_release:' || p_order_id::text, 'Released reserved credit');

  update public.orders
  set store_credit_applied_cents = 0,
      payment_due_cents = total_cents
  where id = p_order_id and status not in ('paid', 'fulfilled');

  return v_amount;
end;
$$;

-- ---------------------------------------------------------------------------
-- Finalise a reserved credit hold on successful payment: relabel the reserve
-- as a spend (the balance was already debited by the reserve). Idempotent and
-- a no-op if the hold was already released. Returns the finalised amount.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_store_credit_for_order(p_order_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_amount bigint;
  v_rows integer;
begin
  select user_id, -delta_cents into v_user, v_amount
  from public.store_credit_ledger
  where idempotency_key = 'store_credit_reserve:' || p_order_id::text
    and source = 'store_credit_reserve';

  if not found then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtext('storecredit:' || v_user::text));

  -- A released hold must never be finalised into a spend.
  if exists (
    select 1 from public.store_credit_ledger
    where idempotency_key = 'store_credit_release:' || p_order_id::text
  ) then
    return 0;
  end if;

  update public.store_credit_ledger
  set source = 'store_purchase_spend', note = 'Store credit spent'
  where idempotency_key = 'store_credit_reserve:' || p_order_id::text
    and source = 'store_credit_reserve';

  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    return v_amount;
  end if;
  return 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Complete a full-store-credit order with no payment provider: atomically
-- debit the full total, then run the normal fulfilment + gift-card minting.
-- Idempotent. Returns false if the balance is insufficient or the order is in
-- a non-fulfillable state.
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
  if not found then
    return false;
  end if;
  if v_order.user_id is distinct from p_user_id then
    return false;
  end if;
  -- Idempotent success if already processed.
  if v_order.status in ('paid', 'fulfilled') then
    return true;
  end if;
  if v_order.status <> 'pending' then
    return false;
  end if;

  select coalesce(sum(delta_cents), 0) into v_available
  from public.store_credit_ledger
  where user_id = p_user_id;

  if v_available < v_order.total_cents then
    return false;
  end if;

  insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
  values (p_user_id, -v_order.total_cents, 'store_purchase_spend', p_order_id::text,
          'store_credit_spend:' || p_order_id::text, 'Store credit checkout')
  on conflict (idempotency_key) do nothing;

  update public.orders
  set store_credit_applied_cents = v_order.total_cents,
      payment_due_cents = 0,
      provider = 'gift_card',
      provider_payment_id = 'store_credit',
      paid_at = coalesce(paid_at, now())
  where id = p_order_id;

  perform public.fulfill_paid_order(p_order_id);
  perform public.issue_gift_cards_for_order(p_order_id);

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants — service role only (all calls come from the checkout/webhook API).
-- ---------------------------------------------------------------------------
revoke all on function public.reserve_store_credit_for_order(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_store_credit_for_order(uuid) from public, anon, authenticated;
revoke all on function public.finalize_store_credit_for_order(uuid) from public, anon, authenticated;
revoke all on function public.complete_store_credit_only_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_store_credit_for_order(uuid, uuid, integer) to service_role;
grant execute on function public.release_store_credit_for_order(uuid) to service_role;
grant execute on function public.finalize_store_credit_for_order(uuid) to service_role;
grant execute on function public.complete_store_credit_only_order(uuid, uuid) to service_role;
