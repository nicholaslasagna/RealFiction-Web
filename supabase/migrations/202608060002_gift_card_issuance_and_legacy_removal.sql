-- Atomic gift-card issuance, and removal of the insecure legacy redemption path.
--
-- PART A REMOVES A PATH RATHER THAN KEEPING IT "for compatibility"
-- ================================================================
-- 202605300030's `redeem_gift_card(code_hash, user)` takes a client-computed
-- SHA-256 over a 48-bit code space. Possession of the HASH redeems, and the
-- hash is derivable from the code by anyone, so that function is a second,
-- weaker door into the same value as the new claim path.
--
-- Gift cards have never been enabled, so no legitimate issued card should
-- exist. This migration ABORTS if any does, rather than guessing: destroying
-- issued value would be worse than stopping, and silently leaving the weak door
-- open would be worse than both. The operator gets a preflight query and a
-- documented rotation plan instead.
--
-- PART B is the issuance transaction. A paid gift-card order must produce the
-- card, exactly one credential, and BOTH emails, or produce nothing at all — a
-- card that exists but was never delivered is paid-for value the customer
-- cannot reach.

-- ===========================================================================
-- A. Legacy removal, guarded
-- ===========================================================================

/**
 * Read-only preflight. Run this BEFORE the migration on any database whose
 * history you are unsure of.
 *
 * `redeemable` is the number that matters: a card that is still 'active' and
 * carries a legacy plaintext code is value somebody may still be holding.
 */
create or replace function public.gift_card_legacy_preflight()
returns table(total_cards integer, legacy_coded integer, redeemable integer, redeemable_value_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::integer,
    count(*) filter (where code is not null or code_hash is not null)::integer,
    count(*) filter (where (code is not null or code_hash is not null) and status = 'active')::integer,
    coalesce(sum(balance_cents) filter (
      where (code is not null or code_hash is not null) and status = 'active'
    ), 0)::bigint
  from public.gift_cards
$$;

revoke all on function public.gift_card_legacy_preflight() from public, anon, authenticated;
grant execute on function public.gift_card_legacy_preflight() to service_role;

do $$
declare
  v_redeemable integer;
  v_value bigint;
begin
  select redeemable, redeemable_value_cents into v_redeemable, v_value
  from public.gift_card_legacy_preflight();

  if coalesce(v_redeemable, 0) > 0 then
    raise exception using
      errcode = 'raise_exception',
      message = format(
        'ABORT: %s redeemable legacy gift card(s) worth %s cents exist. '
        'This migration removes the plaintext-code redemption path and would strand them.',
        v_redeemable, v_value
      ),
      hint =
        'Gift cards were never enabled, so this should be zero. Run '
        'select * from public.gift_card_legacy_preflight(); to inspect, then follow '
        'docs/GIFT_CARD_LEGACY_ROTATION.md to reissue those cards under the new '
        'credential scheme before re-running this migration. Do not delete rows.';
  end if;
end $$;

-- No redeemable legacy cards. Remove the weak door entirely.
drop function if exists public.redeem_gift_card(text, uuid);

alter table public.gift_cards drop column if exists code;
alter table public.gift_cards drop column if exists code_hash;

-- The account page reads gift cards through a service-role query that selects
-- presentation columns only; the table itself stays closed.
drop policy if exists "gift_cards_owner_read" on public.gift_cards;
revoke all on table public.gift_cards from public, anon, authenticated;
grant all on table public.gift_cards to service_role;

-- ===========================================================================
-- B. Issuance
-- ===========================================================================

alter table public.gift_cards
  add column if not exists issued_at timestamptz,
  add column if not exists purchaser_email text,
  add column if not exists delivery_state text
    check (delivery_state is null or delivery_state in ('queued', 'sent', 'failed'));

/**
 * Issues the card for a paid gift-card order. ONE transaction, exactly once.
 *
 * The caller has already generated the 256-bit secret, computed its keyed
 * verifier, and sealed it. Only the derived values arrive here — the raw secret
 * never touches the database, so it cannot surface in `pg_stat_statements`, a
 * slow-query log, or an error detail.
 *
 * Everything a customer paid for happens here or nothing does: the card, its
 * single active credential, the purchaser confirmation, the recipient delivery,
 * and the order's terminal state. If the outbox insert fails, the card does not
 * exist and the order is not fulfilled, so the webhook's 500 brings Stripe back
 * to try again.
 *
 * Deliberately creates NO reward_queue row. RealCore delivers Minecraft
 * products; a gift card is store credit and has nothing for it to grant.
 */
create or replace function public.issue_gift_card_for_order(
  p_order_id uuid,
  p_verifier text,
  p_delivery_ciphertext text,
  p_delivery_key_version integer,
  p_masked_suffix text,
  p_payment_intent_id text default null,
  p_charge_id text default null
)
returns table(issued boolean, outcome text, gift_card_id uuid, public_ref text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_existing public.gift_cards%rowtype;
  v_card_id uuid;
  v_ref text;
  v_recipient text;
begin
  issued := false; outcome := 'unknown'; gift_card_id := null; public_ref := null;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    outcome := 'order_not_found'; return next; return;
  end if;

  -- Exactly one gift-card line. The checkout route enforces this too; enforced
  -- again here because this function is the last thing standing between a
  -- malformed order and issued value.
  select oi.id as order_item_id, oi.quantity, p.slug, p.price_cents, p.category
  into v_item
  from public.order_items oi
  join public.products p on p.id = oi.product_id
  where oi.order_id = p_order_id;

  if not found then
    outcome := 'no_order_item'; return next; return;
  end if;
  if v_item.category <> 'gift_cards' then
    outcome := 'not_a_gift_card_order'; return next; return;
  end if;
  if v_item.quantity <> 1 then
    outcome := 'quantity_must_be_one'; return next; return;
  end if;
  if (select count(*) from public.order_items where order_id = p_order_id) <> 1 then
    outcome := 'mixed_cart'; return next; return;
  end if;

  -- Face value comes from the PRODUCT, never from the order or the client.
  if v_order.total_cents <> v_item.price_cents then
    outcome := 'value_mismatch'; return next; return;
  end if;

  -- Idempotent: a webhook replay or a reconciliation pass finds the card and
  -- issues nothing further.
  select * into v_existing from public.gift_cards
  where order_item_id = v_item.order_item_id and order_item_seq = 1;

  if found then
    issued := false; outcome := 'already_issued';
    gift_card_id := v_existing.id; public_ref := v_existing.public_ref;
    return next; return;
  end if;

  if p_verifier is null or length(p_verifier) < 32 then
    outcome := 'credential_missing'; return next; return;
  end if;
  if p_delivery_ciphertext is null or length(p_delivery_ciphertext) < 16 then
    -- A card that cannot be delivered must not be issued.
    outcome := 'sealed_secret_missing'; return next; return;
  end if;

  v_recipient := lower(trim(coalesce(v_order.metadata->>'gift_recipient_email', '')));
  if v_recipient = '' then
    outcome := 'recipient_missing'; return next; return;
  end if;

  v_ref := 'RFG-' || upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 10));

  insert into public.gift_cards (
    original_balance_cents, balance_cents, currency,
    purchaser_user_id, purchaser_order_id, order_item_id, order_item_seq,
    status, public_ref, recipient_email, sender_display_name, gift_message,
    purchaser_email, issued_at, delivery_state
  )
  values (
    v_item.price_cents, v_item.price_cents, coalesce(v_order.currency, 'USD'),
    v_order.user_id, p_order_id, v_item.order_item_id, 1,
    'active', v_ref, v_recipient,
    left(coalesce(v_order.metadata->>'gift_sender_name', ''), 60),
    left(coalesce(v_order.metadata->>'gift_message', ''), 500),
    v_order.buyer_email, now(), 'queued'
  )
  returning id into v_card_id;

  -- Exactly one active credential. The partial unique index makes a second
  -- concurrent issuance a constraint violation rather than a second live secret.
  insert into public.gift_card_claim_credentials (
    gift_card_id, verifier, delivery_ciphertext, delivery_key_version,
    masked_suffix, state, issue_reason
  )
  values (
    v_card_id, p_verifier, p_delivery_ciphertext, coalesce(p_delivery_key_version, 1),
    left(coalesce(p_masked_suffix, ''), 8), 'active', 'issued'
  );

  -- Payment references, then the terminal order state.
  update public.orders
  set provider_payment_id = coalesce(p_payment_intent_id, provider_payment_id),
      stripe_charge_id = coalesce(p_charge_id, stripe_charge_id),
      paid_at = coalesce(paid_at, now()),
      status = 'fulfilled',
      fulfilled_at = coalesce(fulfilled_at, now())
  where id = p_order_id;

  -- BOTH deliveries, in this transaction. If either insert fails the card does
  -- not exist and the order is not fulfilled.
  insert into public.email_deliveries (
    idempotency_key, template, recipient, order_id, params
  )
  values (
    'gift_card_purchase:' || v_card_id::text, 'gift_card_purchase',
    v_order.buyer_email, p_order_id,
    jsonb_build_object(
      'gift_card_id', v_card_id,
      'public_ref', v_ref,
      'amount_cents', v_item.price_cents,
      'currency', coalesce(v_order.currency, 'USD'),
      'recipient_email', v_recipient,
      'sender_name', left(coalesce(v_order.metadata->>'gift_sender_name', ''), 60)
    )
  )
  on conflict (idempotency_key) do nothing;

  insert into public.email_deliveries (
    idempotency_key, template, recipient, order_id, params
  )
  values (
    'gift_card_delivery:' || v_card_id::text, 'gift_card_delivery',
    v_recipient, p_order_id,
    jsonb_build_object(
      'gift_card_id', v_card_id,
      'public_ref', v_ref,
      'amount_cents', v_item.price_cents,
      'currency', coalesce(v_order.currency, 'USD'),
      'sender_name', left(coalesce(v_order.metadata->>'gift_sender_name', ''), 60),
      'message', left(coalesce(v_order.metadata->>'gift_message', ''), 500)
      -- NOTE: no claim secret here. The email worker opens the sealed secret
      -- from the credential row while rendering, so the plaintext never rests
      -- in a queue row that is retried, logged, and inspected by staff.
    )
  )
  on conflict (idempotency_key) do nothing;

  issued := true; outcome := 'issued';
  gift_card_id := v_card_id; public_ref := v_ref;
  return next;
end;
$$;

revoke all on function public.issue_gift_card_for_order(uuid, text, text, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.issue_gift_card_for_order(uuid, text, text, integer, text, text, text)
  to service_role;

-- The old bulk issuer minted cards from inside ordinary fulfilment. Gift cards
-- now have their own dedicated path, and leaving the old one callable would let
-- a mixed cart mint cards outside it.
--
-- `complete_store_credit_only_order` still calls it, so that function is
-- re-declared here WITHOUT the call before the drop. Store credit can never buy
-- a gift card (the checkout guard refuses it, and a gift card bought with a gift
-- card is the classic laundering loop), so the call was already dead code on
-- every path that can still run.
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

  -- A store-credit order may never contain a gift card. Enforced here as well
  -- as in the route: this is the function that actually spends the balance.
  if exists (
    select 1 from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.category = 'gift_cards'
  ) then
    return false;
  end if;

  select coalesce(sum(delta_cents), 0) into v_available
  from public.store_credit_ledger where user_id = p_user_id;

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
  -- Lot allocations reserved at checkout become spent in this same transaction.
  perform public.consume_credit_lots(p_order_id);
  perform public.enqueue_order_confirmation_delivery(p_order_id);

  return true;
end;
$$;

revoke all on function public.complete_store_credit_only_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_store_credit_only_order(uuid, uuid) to service_role;

drop function if exists public.issue_gift_cards_for_order(uuid);

-- ===========================================================================
-- C. Availability is unchanged
-- ===========================================================================
update public.products
set active = false, updated_at = now()
where category = 'gift_cards' and active;
