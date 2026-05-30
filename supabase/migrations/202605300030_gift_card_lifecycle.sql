-- Phase 19: Gift card lifecycle — code generation on purchase + redemption to
-- store credit.
--
-- Builds on:
--   - public.gift_cards / public.gift_card_redemptions (migration 0001)
--   - public.store_credit_ledger / get_store_credit_balance (migration 0028)
--
-- Adds:
--   1. Reveal/redeem columns on gift_cards (plaintext code for the purchaser to
--      copy, plus binding columns).
--   2. issue_gift_cards_for_order(order_id) — generates a secure code per gift
--      card unit when a gift-card order is paid (idempotent), and removes the
--      placeholder store reward_queue rows so a gift card never becomes a
--      "Needs help" in-game reward.
--   3. redeem_gift_card(code_hash, user) — atomically moves a card's balance
--      into the redeemer's store_credit_ledger and binds the card to them.
--   4. A guard in fulfill_paid_order so gift-card SKUs never enqueue a plugin
--      reward (gift cards are store credit, not Minecraft perks).
--
-- Plaintext tradeoff: the account page must let the *purchaser* reveal/copy the
-- code after payment, so the plaintext code is stored alongside the sha256
-- code_hash. It is readable only by the owning purchaser (RLS) or the
-- service role, is never returned in any public/list API, and is never logged.
-- Redemption matches on the hash, so a stored plaintext is not required for the
-- redeem path itself.

set search_path = public;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) gift_cards lifecycle columns + status values.
-- ---------------------------------------------------------------------------
alter table public.gift_cards add column if not exists code text;
alter table public.gift_cards add column if not exists purchaser_order_id uuid references public.orders(id) on delete set null;
alter table public.gift_cards add column if not exists order_item_id uuid references public.order_items(id) on delete set null;
alter table public.gift_cards add column if not exists order_item_seq integer not null default 1;
alter table public.gift_cards add column if not exists redeemed_by uuid references public.profiles(id) on delete set null;
alter table public.gift_cards add column if not exists redeemed_at timestamptz;
alter table public.gift_cards add column if not exists last_used_at timestamptz;

-- Allow 'redeemed' and 'void' in addition to the original states.
alter table public.gift_cards drop constraint if exists gift_cards_status_check;
alter table public.gift_cards
  add constraint gift_cards_status_check
  check (status in ('active', 'redeemed', 'depleted', 'expired', 'revoked', 'void'));

-- One generated card per (order_item, unit) — makes issuance idempotent so a
-- webhook retry can never mint duplicate cards.
create unique index if not exists gift_cards_order_item_seq_idx
  on public.gift_cards(order_item_id, order_item_seq)
  where order_item_id is not null;

create index if not exists gift_cards_purchaser_idx
  on public.gift_cards(purchaser_user_id, created_at desc);

-- Owner (purchaser) can read their own cards so the account page can reveal the
-- code. All writes stay with the service role.
alter table public.gift_cards enable row level security;
drop policy if exists "gift_cards_owner_read" on public.gift_cards;
create policy "gift_cards_owner_read"
  on public.gift_cards for select
  to authenticated
  using (purchaser_user_id = auth.uid());

revoke all on table public.gift_cards from public, anon;
grant select on table public.gift_cards to authenticated;
grant select, insert, update, delete on table public.gift_cards to service_role;

-- ---------------------------------------------------------------------------
-- 2) Issue gift card codes for a paid order (idempotent).
--    Also clears the placeholder store reward_queue rows fulfill_paid_order
--    created for the gift-card items (belt-and-suspenders alongside the
--    fulfill_paid_order guard below).
-- ---------------------------------------------------------------------------
create or replace function public.issue_gift_cards_for_order(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_seq integer;
  v_value_cents integer;
  v_code text;
  v_hash text;
  v_attempt integer;
  v_created integer := 0;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return 0;
  end if;

  for v_item in
    select oi.id as order_item_id, oi.quantity, p.metadata, p.price_cents, p.category
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id
      and p.category = 'gift_cards'
  loop
    -- Gift cards never deliver an in-game reward.
    delete from public.reward_queue
    where source = 'store'
      and source_id = v_item.order_item_id
      and status = 'pending';

    v_value_cents := coalesce((v_item.metadata->>'gift_card_value_cents')::integer, v_item.price_cents);
    if v_value_cents is null or v_value_cents <= 0 then
      continue;
    end if;

    for v_seq in 1..greatest(v_item.quantity, 1) loop
      -- Skip if this exact unit already minted a card (idempotent retry).
      if exists (
        select 1 from public.gift_cards
        where order_item_id = v_item.order_item_id and order_item_seq = v_seq
      ) then
        continue;
      end if;

      -- Generate a unique, unpredictable code: RF-XXXX-XXXX-XXXX (uppercase
      -- hex, 48 bits of CSPRNG entropy). Retry on the astronomically unlikely
      -- hash collision.
      v_attempt := 0;
      loop
        v_attempt := v_attempt + 1;
        v_code := 'RF-'
          || upper(substr(encode(gen_random_bytes(2), 'hex'), 1, 4)) || '-'
          || upper(substr(encode(gen_random_bytes(2), 'hex'), 1, 4)) || '-'
          || upper(substr(encode(gen_random_bytes(2), 'hex'), 1, 4));
        v_hash := encode(digest(upper(regexp_replace(v_code, '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex');

        begin
          insert into public.gift_cards (
            code, code_hash, original_balance_cents, balance_cents, currency,
            purchaser_user_id, purchaser_order_id, order_item_id, order_item_seq, status
          ) values (
            v_code, v_hash, v_value_cents, v_value_cents, 'USD',
            v_order.user_id, p_order_id, v_item.order_item_id, v_seq, 'active'
          );
          v_created := v_created + 1;
          exit;
        exception when unique_violation then
          if v_attempt >= 5 then
            raise;
          end if;
          -- retry with a fresh code
        end;
      end loop;
    end loop;
  end loop;

  return v_created;
end;
$$;

revoke all on function public.issue_gift_cards_for_order(uuid) from public, anon, authenticated;
grant execute on function public.issue_gift_cards_for_order(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Redeem a gift card into the redeemer's store credit (atomic).
--    The caller passes the sha256 of the normalized code, so the plaintext
--    never crosses the RPC boundary or appears in DB logs.
--    Outcomes: redeemed | already_self | already_other | invalid
-- ---------------------------------------------------------------------------
create or replace function public.redeem_gift_card(p_code_hash text, p_user_id uuid)
returns table (outcome text, amount_cents integer, balance_cents bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.gift_cards%rowtype;
  v_amount integer;
begin
  if p_user_id is null then
    outcome := 'invalid'; amount_cents := 0; balance_cents := 0; return next; return;
  end if;

  select * into v_card from public.gift_cards where code_hash = p_code_hash for update;

  if not found then
    outcome := 'invalid'; amount_cents := 0;
    select coalesce(sum(delta_cents), 0) into balance_cents from public.store_credit_ledger where user_id = p_user_id;
    return next; return;
  end if;

  if v_card.status = 'redeemed' then
    outcome := case when v_card.redeemed_by = p_user_id then 'already_self' else 'already_other' end;
    amount_cents := 0;
    select coalesce(sum(delta_cents), 0) into balance_cents from public.store_credit_ledger where user_id = p_user_id;
    return next; return;
  end if;

  if v_card.status <> 'active' or v_card.balance_cents <= 0 or coalesce(v_card.currency, 'USD') <> 'USD' then
    outcome := 'invalid'; amount_cents := 0;
    select coalesce(sum(delta_cents), 0) into balance_cents from public.store_credit_ledger where user_id = p_user_id;
    return next; return;
  end if;

  if v_card.expires_at is not null and v_card.expires_at < now() then
    update public.gift_cards set status = 'expired', updated_at = now() where id = v_card.id;
    outcome := 'invalid'; amount_cents := 0;
    select coalesce(sum(delta_cents), 0) into balance_cents from public.store_credit_ledger where user_id = p_user_id;
    return next; return;
  end if;

  v_amount := v_card.balance_cents;

  -- Credit the ledger. The unique idempotency_key (one per card) makes a
  -- double-redeem physically impossible even under a race.
  insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
  values (p_user_id, v_amount, 'gift_card_redemption', v_card.id::text, 'giftcard:' || v_card.id::text, 'Gift card redeemed');

  insert into public.gift_card_redemptions (gift_card_id, user_id, amount_cents)
  values (v_card.id, p_user_id, v_amount);

  update public.gift_cards
  set status = 'redeemed',
      balance_cents = 0,
      redeemed_by = p_user_id,
      redeemed_at = now(),
      last_used_at = now(),
      updated_at = now()
  where id = v_card.id;

  outcome := 'redeemed';
  amount_cents := v_amount;
  select coalesce(sum(delta_cents), 0) into balance_cents from public.store_credit_ledger where user_id = p_user_id;
  return next;
end;
$$;

revoke all on function public.redeem_gift_card(text, uuid) from public, anon, authenticated;
grant execute on function public.redeem_gift_card(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4) Guard fulfill_paid_order so gift-card SKUs never enqueue a plugin reward.
--    Reproduced from migration 0002 verbatim except the reward_queue insert is
--    now skipped for category = 'gift_cards' (gift cards mint a code instead,
--    via issue_gift_cards_for_order). Entitlements were already skipped for
--    gift cards because they are fulfillment_type = 'consumable'.
-- ---------------------------------------------------------------------------
create or replace function public.fulfill_paid_order(p_order_id uuid)
returns table(order_id uuid, created_entitlements integer, created_rewards integer, already_fulfilled boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_entitlement_key text;
  v_expires_at timestamptz;
  v_entitlements integer := 0;
  v_rewards integer := 0;
  v_rows integer := 0;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if v_order.status = 'fulfilled' then
    order_id := p_order_id;
    created_entitlements := 0;
    created_rewards := 0;
    already_fulfilled := true;
    return next;
    return;
  end if;

  if v_order.status not in ('paid', 'pending') then
    raise exception 'Order % is not fulfillable from status %', p_order_id, v_order.status;
  end if;

  update public.orders
  set status = 'paid',
      paid_at = coalesce(paid_at, now())
  where id = p_order_id;

  for v_item in
    select
      oi.id as order_item_id,
      oi.quantity,
      oi.product_snapshot,
      p.id as product_id,
      p.slug,
      p.category,
      p.name,
      p.fulfillment_type,
      p.duration_days,
      p.metadata
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id
  loop
    v_entitlement_key := 'product:' || v_item.slug;
    v_expires_at := null;

    if v_item.fulfillment_type = 'subscription' and v_item.duration_days is not null then
      v_expires_at := now() + make_interval(days => v_item.duration_days);
    end if;

    if v_item.fulfillment_type <> 'consumable' then
      insert into public.entitlements (
        user_id,
        minecraft_uuid,
        minecraft_username,
        product_id,
        order_item_id,
        entitlement_key,
        status,
        starts_at,
        expires_at,
        metadata
      )
      values (
        v_order.user_id,
        v_order.minecraft_uuid,
        coalesce(v_order.gifted_to_minecraft_username, v_order.minecraft_username),
        v_item.product_id,
        v_item.order_item_id,
        v_entitlement_key,
        'active',
        now(),
        v_expires_at,
        jsonb_build_object(
          'source', 'order',
          'order_id', p_order_id,
          'product_slug', v_item.slug,
          'quantity', v_item.quantity,
          'gifted', v_order.gifted_to_minecraft_username is not null
        )
      )
      on conflict (order_item_id, entitlement_key) where order_item_id is not null do nothing;

      get diagnostics v_rows = row_count;
      v_entitlements := v_entitlements + v_rows;
    end if;

    -- Gift cards are store credit, not a Minecraft reward — issuing a plugin
    -- reward_queue row would surface as a "Needs help" delivery with no target.
    if v_item.category <> 'gift_cards' then
      insert into public.reward_queue (
        user_id,
        minecraft_uuid,
        minecraft_username,
        source,
        source_id,
        reward_key,
        payload,
        idempotency_key,
        status,
        available_at
      )
      values (
        v_order.user_id,
        v_order.minecraft_uuid,
        coalesce(v_order.gifted_to_minecraft_username, v_order.minecraft_username),
        'store',
        v_item.order_item_id,
        'store.' || v_item.slug,
        jsonb_build_object(
          'order_id', p_order_id,
          'order_item_id', v_item.order_item_id,
          'product_id', v_item.product_id,
          'product_slug', v_item.slug,
          'category', v_item.category,
          'fulfillment_type', v_item.fulfillment_type,
          'duration_days', v_item.duration_days,
          'quantity', v_item.quantity,
          'metadata', v_item.metadata,
          'safe_reward', true
        ),
        'order_item:' || v_item.order_item_id::text,
        'pending',
        now()
      )
      on conflict (idempotency_key) do nothing;

      get diagnostics v_rows = row_count;
      v_rewards := v_rewards + v_rows;
    end if;
  end loop;

  update public.orders
  set status = 'fulfilled',
      fulfilled_at = coalesce(fulfilled_at, now())
  where id = p_order_id;

  order_id := p_order_id;
  created_entitlements := v_entitlements;
  created_rewards := v_rewards;
  already_fulfilled := false;
  return next;
end;
$$;

revoke all on function public.fulfill_paid_order(uuid) from public, anon, authenticated;
grant execute on function public.fulfill_paid_order(uuid) to service_role;
