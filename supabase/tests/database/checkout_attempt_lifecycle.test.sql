-- Checkout attempt lifecycle: bounded lifetime, active-cart lock, and
-- compare-and-set session attachment. Exercises the REAL migrated functions.
--
-- Why the active-cart lock exists: per-attempt uniqueness alone did not stop two
-- browser tabs (or a reload that lost its client-side id) from minting two
-- attempt UUIDs and therefore two simultaneously payable Stripe Sessions.

begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

insert into auth.users (id, email)
values ('11110000-0000-4000-8000-000000000001', 'lifecycle@example.test')
on conflict (id) do nothing;
insert into public.profiles (id, email)
values ('11110000-0000-4000-8000-000000000001', 'lifecycle@example.test')
on conflict (id) do nothing;

insert into auth.users (id, email)
values ('11110000-0000-4000-8000-000000000002', 'other@example.test')
on conflict (id) do nothing;
insert into public.profiles (id, email)
values ('11110000-0000-4000-8000-000000000002', 'other@example.test')
on conflict (id) do nothing;

create or replace function pg_temp.mk_order(p_id uuid, p_user uuid)
returns uuid language plpgsql as $$
begin
  insert into public.orders (
    id, user_id, minecraft_username, provider, status,
    subtotal_cents, discount_cents, total_cents, payment_due_cents, currency
  ) values (p_id, p_user, 'LifecycleTester', 'stripe', 'pending', 499, 0, 499, 499, 'USD');
  return p_id;
end; $$;

-- 1. First claim of a new attempt ------------------------------------------
select is(
  (select status from public.claim_checkout_attempt(
    '11110000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-000000000001', 'cart-A', 3600)),
  'new', 'a fresh attempt claims successfully');

-- 2. Same attempt id resumes, never duplicates -----------------------------
select is(
  (select status from public.claim_checkout_attempt(
    '11110000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-000000000001', 'cart-A', 3600)),
  'resumed', 'the same attempt id resumes');

-- 3. THE two-tab case: different attempt UUID, same user + cart -------------
select is(
  (select status from public.claim_checkout_attempt(
    '11110000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-000000000002', 'cart-A', 3600)),
  'active_elsewhere', 'a second tab cannot open a second active checkout');

select is(
  (select count(*)::integer from public.checkout_attempts
   where user_id = '11110000-0000-4000-8000-000000000001' and closed_at is null),
  1, 'exactly one active checkout exists for the cart');

-- 4. A different cart is independent ---------------------------------------
select is(
  (select status from public.claim_checkout_attempt(
    '11110000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-000000000003', 'cart-B', 3600)),
  'new', 'a different cart may start its own checkout');

-- 5. A different user is independent ---------------------------------------
select is(
  (select status from public.claim_checkout_attempt(
    '11110000-0000-4000-8000-000000000002', '22220000-0000-4000-8000-000000000004', 'cart-A', 3600)),
  'new', 'another user is unaffected by the lock');

-- 6. Closing releases the lock; a new attempt may then buy the same cart ----
select ok(
  (select public.close_checkout_attempt(
     (select id from public.checkout_attempts
      where user_id='11110000-0000-4000-8000-000000000001' and cart_fingerprint='cart-A' and closed_at is null),
     'cancelled')),
  'an active attempt can be closed atomically');

select is(
  (select status from public.claim_checkout_attempt(
    '11110000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-000000000005', 'cart-A', 3600)),
  'new', 'after the previous attempt is terminal, the same cart may be bought again');

-- 7. A closed attempt can never be revived ---------------------------------
select is(
  (select status from public.claim_checkout_attempt(
    '11110000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-000000000001', 'cart-A', 3600)),
  'closed', 'a closed attempt is terminal and cannot be revived');

-- 8. Expiry: an attempt past its lifetime is swept and cannot be reused ----
update public.checkout_attempts
set attempt_expires_at = now() - interval '1 minute'
where user_id = '11110000-0000-4000-8000-000000000001'
  and cart_fingerprint = 'cart-B'
  and closed_at is null;

select is(
  (select status from public.claim_checkout_attempt(
    '11110000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-000000000003', 'cart-B', 3600)),
  'closed', 'an expired attempt is closed and cannot create another Session');

select is(
  (select closed_reason from public.checkout_attempts
   where attempt_id = '22220000-0000-4000-8000-000000000003'),
  'expired', 'the expiry sweep records why it closed');

-- 9. Expiry releases the cart lock -----------------------------------------
select is(
  (select status from public.claim_checkout_attempt(
    '11110000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-000000000006', 'cart-B', 3600)),
  'new', 'an expired attempt no longer holds the cart lock');

-- 10. Attempts default to a bounded, non-null lifetime ---------------------
select ok(
  (select attempt_expires_at from public.checkout_attempts
   where attempt_id = '22220000-0000-4000-8000-000000000006')
   between now() + interval '55 minutes' and now() + interval '65 minutes',
  'a new attempt expires about an hour out');

-- 11. Session attachment is compare-and-set --------------------------------
select ok(
  (select public.attach_checkout_session(
    (select id from public.checkout_attempts where attempt_id='22220000-0000-4000-8000-000000000006'),
    'cs_test_FIRST', 'https://checkout.stripe.com/first', now() + interval '1 hour')),
  'the first Session attaches');

select ok(
  (select public.attach_checkout_session(
    (select id from public.checkout_attempts where attempt_id='22220000-0000-4000-8000-000000000006'),
    'cs_test_FIRST', 'https://checkout.stripe.com/first', now() + interval '1 hour')),
  're-attaching the SAME Session is an idempotent success');

select ok(
  not (select public.attach_checkout_session(
    (select id from public.checkout_attempts where attempt_id='22220000-0000-4000-8000-000000000006'),
    'cs_test_SECOND', 'https://checkout.stripe.com/second', now() + interval '1 hour')),
  'a DIFFERENT Session can never replace an attached one');

select is(
  (select stripe_session_id from public.checkout_attempts
   where attempt_id='22220000-0000-4000-8000-000000000006'),
  'cs_test_FIRST', 'the originally attached Session remains authoritative');

-- 12. One order <-> one attempt --------------------------------------------
select pg_temp.mk_order('33330000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000001');
select public.attach_checkout_attempt_order(
  (select id from public.checkout_attempts where attempt_id='22220000-0000-4000-8000-000000000006'),
  '33330000-0000-4000-8000-000000000001');

select throws_ok(
  $$ select public.attach_checkout_attempt_order(
       (select id from public.checkout_attempts where attempt_id='22220000-0000-4000-8000-000000000005'),
       '33330000-0000-4000-8000-000000000001') $$,
  '23505',
  null,
  'one order cannot be attached to two different attempts');

-- 13. EVERY terminal order transition closes the attempt atomically ---------
-- Covers paid fulfilment, async payment failure, session expiry, internal
-- cancellation, refund and chargeback — via a trigger, so a future terminal
-- path cannot forget to release the lock.
create or replace function pg_temp.attempt_for(p_cart text)
returns public.checkout_attempts language sql as $$
  select * from public.checkout_attempts
  where user_id = '11110000-0000-4000-8000-000000000001' and cart_fingerprint = p_cart
  order by created_at desc limit 1;
$$;

create or replace function pg_temp.setup_terminal(p_cart text, p_attempt uuid, p_order uuid)
returns void language plpgsql as $$
begin
  perform public.claim_checkout_attempt(
    '11110000-0000-4000-8000-000000000001', p_attempt, p_cart, 3600);
  perform pg_temp.mk_order(p_order, '11110000-0000-4000-8000-000000000001');
  perform public.attach_checkout_attempt_order(
    (select id from public.checkout_attempts
     where user_id='11110000-0000-4000-8000-000000000001' and attempt_id = p_attempt),
    p_order);
end; $$;

-- paid
select pg_temp.setup_terminal('cart-T1', '44440000-0000-4000-8000-000000000001', '55550000-0000-4000-8000-000000000001');
update public.orders set status = 'paid' where id = '55550000-0000-4000-8000-000000000001';
select is((pg_temp.attempt_for('cart-T1')).closed_reason, 'order_paid',
  'a PAID order closes its checkout attempt');

-- fulfilled
select pg_temp.setup_terminal('cart-T2', '44440000-0000-4000-8000-000000000002', '55550000-0000-4000-8000-000000000002');
update public.orders set status = 'fulfilled' where id = '55550000-0000-4000-8000-000000000002';
select is((pg_temp.attempt_for('cart-T2')).closed_reason, 'order_fulfilled',
  'a FULFILLED order closes its checkout attempt');

-- cancelled (async_payment_failed / expired / internal cancellation all land here)
select pg_temp.setup_terminal('cart-T3', '44440000-0000-4000-8000-000000000003', '55550000-0000-4000-8000-000000000003');
select public.mark_order_unpaid_closed('55550000-0000-4000-8000-000000000003', 'payment_failed');
select is((pg_temp.attempt_for('cart-T3')).closed_reason, 'order_cancelled',
  'an async-payment-failed / expired / cancelled order closes its attempt');

-- refunded
select pg_temp.setup_terminal('cart-T4', '44440000-0000-4000-8000-000000000004', '55550000-0000-4000-8000-000000000004');
update public.orders set status = 'refunded' where id = '55550000-0000-4000-8000-000000000004';
select is((pg_temp.attempt_for('cart-T4')).closed_reason, 'order_refunded',
  'a REFUNDED order closes its checkout attempt');

-- chargeback
select pg_temp.setup_terminal('cart-T5', '44440000-0000-4000-8000-000000000005', '55550000-0000-4000-8000-000000000005');
update public.orders set status = 'chargeback' where id = '55550000-0000-4000-8000-000000000005';
select is((pg_temp.attempt_for('cart-T5')).closed_reason, 'order_chargeback',
  'a CHARGEBACK order closes its checkout attempt');

-- Closing is atomic with the status change, and releases the cart lock so the
-- SAME cart can be bought again through a new attempt.
select is(
  (select count(*)::integer from public.checkout_attempts
   where user_id='11110000-0000-4000-8000-000000000001'
     and cart_fingerprint in ('cart-T1','cart-T2','cart-T3','cart-T4','cart-T5')
     and closed_at is null),
  0, 'no terminal attempt still holds its cart lock');

select is(
  (select status from public.claim_checkout_attempt(
    '11110000-0000-4000-8000-000000000001', '44440000-0000-4000-8000-000000000009', 'cart-T1', 3600)),
  'new', 'after payment, the same cart can be bought again via a NEW attempt');

-- A pending order must NOT close the attempt (checkout still in progress).
select pg_temp.setup_terminal('cart-T6', '44440000-0000-4000-8000-000000000006', '55550000-0000-4000-8000-000000000006');
update public.orders set minecraft_username = 'Touched' where id = '55550000-0000-4000-8000-000000000006';
select ok((pg_temp.attempt_for('cart-T6')).closed_at is null,
  'a still-pending order leaves its attempt active');

select * from finish();

rollback;
