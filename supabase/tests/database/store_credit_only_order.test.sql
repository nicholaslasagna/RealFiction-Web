-- Fully store-credit-funded orders.
--
-- A positive-value cart covered entirely by credit is a REAL purchase: it must
-- fulfil exactly once, consume credit exactly once, close its checkout attempt,
-- and never involve Stripe. Distinct from a $0 cart, which is not a purchase.

begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email) values ('5c000000-0000-4000-8000-000000000001', 'credit@example.test')
on conflict (id) do nothing;
insert into public.profiles (id, email) values ('5c000000-0000-4000-8000-000000000001', 'credit@example.test')
on conflict (id) do nothing;

insert into public.products (
  id, slug, category, name, description, price_cents, currency,
  fulfillment_type, duration_days, metadata, active
) values (
  '5c000000-0000-4000-8000-0000000000b1', 'credit-test-1m', 'supporter', 'Credit Test', 'd',
  1299, 'USD', 'subscription', 30, '{"safe_reward": true}'::jsonb, true
) on conflict (slug) do update set active = true, price_cents = 1299;

-- Fund the account with exactly enough credit for one purchase.
insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
values ('5c000000-0000-4000-8000-000000000001', 1299, 'manual_grant', 'test', 'grant:credit-test', 'test grant');

create or replace function pg_temp.mk_credit_order(p_id uuid)
returns uuid language plpgsql as $$
begin
  insert into public.orders (
    id, user_id, buyer_email, minecraft_username, minecraft_uuid, provider, status,
    subtotal_cents, discount_cents, total_cents, store_credit_applied_cents, payment_due_cents, currency
  ) values (
    p_id, '5c000000-0000-4000-8000-000000000001', 'credit@example.test', 'CreditTester',
    '00000000-0000-4000-8000-00000000c0de', 'gift_card', 'pending',
    1299, 0, 1299, 1299, 0, 'USD'
  );
  insert into public.order_items (order_id, product_id, product_snapshot, quantity, unit_price_cents, total_cents)
  values (p_id, '5c000000-0000-4000-8000-0000000000b1', '{"slug":"credit-test-1m"}'::jsonb, 1, 1299, 1299);
  return p_id;
end; $$;

-- 1. A fully funded order completes and fulfils --------------------------------
select pg_temp.mk_credit_order('5c000000-0000-4000-8000-0000000000a1');

-- Bind a checkout attempt so the cart-lock release can be observed.
select public.claim_checkout_attempt(
  '5c000000-0000-4000-8000-000000000001', '5c000000-0000-4000-8000-0000000000e1', 'cart-credit', 3600);
select public.attach_checkout_attempt_order(
  (select id from public.checkout_attempts where attempt_id = '5c000000-0000-4000-8000-0000000000e1'),
  '5c000000-0000-4000-8000-0000000000a1');

select is(
  public.complete_store_credit_only_order(
    '5c000000-0000-4000-8000-0000000000a1', '5c000000-0000-4000-8000-000000000001'),
  true, 'a fully funded order completes');

select is((select status from public.orders where id = '5c000000-0000-4000-8000-0000000000a1'),
  'fulfilled', 'the order is fulfilled through the normal transactional path');

select is((select provider from public.orders where id = '5c000000-0000-4000-8000-0000000000a1'),
  'gift_card', 'no Stripe provider is recorded');

select is((select count(*)::integer from public.entitlements
  where entitlement_key = 'product:credit-test-1m' and status = 'active'),
  1, 'exactly one entitlement is granted');

select is(
  (select balance_cents from public.get_store_credit_balance('5c000000-0000-4000-8000-000000000001')),
  0::bigint, 'the credit is fully consumed');

-- 2. The checkout attempt is closed and the cart lock released ----------------
select ok(
  (select closed_at from public.checkout_attempts
   where attempt_id = '5c000000-0000-4000-8000-0000000000e1') is not null,
  'the checkout attempt is closed');

select is(
  (select status from public.claim_checkout_attempt(
    '5c000000-0000-4000-8000-000000000001', '5c000000-0000-4000-8000-0000000000e9', 'cart-credit', 3600)),
  'new', 'the active-cart lock is released, so the same cart can be bought again');

-- 3. Retrying the SAME order consumes nothing and grants nothing extra --------
select is(
  public.complete_store_credit_only_order(
    '5c000000-0000-4000-8000-0000000000a1', '5c000000-0000-4000-8000-000000000001'),
  true, 'a retry reports success idempotently');

select is((select count(*)::integer from public.entitlements
  where entitlement_key = 'product:credit-test-1m' and status = 'active'),
  1, 'a retry grants no second entitlement');

select is((select count(*)::integer from public.store_credit_ledger
  where idempotency_key = 'store_credit_spend:5c000000-0000-4000-8000-0000000000a1'),
  1, 'a retry consumes no second credit');

select is(
  (select balance_cents from public.get_store_credit_balance('5c000000-0000-4000-8000-000000000001')),
  0::bigint, 'the balance is unchanged by the retry');

-- 4. Insufficient credit can never produce a free order -----------------------
select pg_temp.mk_credit_order('5c000000-0000-4000-8000-0000000000a2');

select is(
  public.complete_store_credit_only_order(
    '5c000000-0000-4000-8000-0000000000a2', '5c000000-0000-4000-8000-000000000001'),
  false, 'an order with no remaining credit is refused');

select is((select status from public.orders where id = '5c000000-0000-4000-8000-0000000000a2'),
  'pending', 'the refused order is never fulfilled');

select is((select count(*)::integer from public.entitlements
  where entitlement_key = 'product:credit-test-1m' and status = 'active'),
  1, 'the refused order grants no entitlement (fails closed)');

select * from finish();

rollback;
