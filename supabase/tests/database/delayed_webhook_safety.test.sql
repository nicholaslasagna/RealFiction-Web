-- THE dangerous interval: Stripe has the money, RealFiction does not know yet.
--
-- Models the real state — order still 'pending', session id persisted, the
-- configured expiry already passed — NOT an order already marked paid (by which
-- point the webhook has already been processed and the risk has gone).

begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

update public.products set active = true
where slug in ('realvip-permanent','real-supporter-permanent');

insert into auth.users (id,email) values
  ('b9000000-0000-4000-8000-000000000001','d1@example.test'),
  ('b9000000-0000-4000-8000-000000000002','d2@example.test'),
  ('b9000000-0000-4000-8000-000000000003','d3@example.test'),
  ('b9000000-0000-4000-8000-000000000004','d4@example.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like 'b9000000%' on conflict do nothing;

-- A fully externally-paid, single-item, fulfilled RealVIP source.
create or replace function pg_temp.src(p_order uuid, p_user uuid) returns void language plpgsql as $$
declare v_pid uuid;
begin
  select id into v_pid from public.products where slug='realvip-permanent';
  insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
    subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
  values (p_order,p_user,'d@e.test','T','stripe','pending',1299,0,1299,0,1299,'USD');
  insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
  values (p_order,v_pid,'{"slug":"realvip-permanent"}'::jsonb,1,1299,1299);
  perform public.fulfill_paid_order(p_order);
end; $$;

-- A PENDING discounted upgrade order with a live Stripe session identity.
create or replace function pg_temp.pending_upgrade(p_order uuid, p_user uuid, p_session text,
  p_expires interval) returns void language plpgsql as $$
declare v_pid uuid;
begin
  select id into v_pid from public.products where slug='real-supporter-permanent';
  insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
    subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
  values (p_order,p_user,'d@e.test','T','stripe','pending',3499,1299,2200,0,2200,'USD');
  insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
  values (p_order,v_pid,'{"slug":"real-supporter-permanent"}'::jsonb,1,3499,3499);
  insert into public.checkout_attempts (user_id,attempt_id,cart_fingerprint,order_id,
    stripe_session_id,stripe_session_expires_at)
  values (p_user,gen_random_uuid(),'cart-'||p_order::text,p_order,p_session, now() + p_expires);
  perform public.reserve_upgrade_credit(p_user,'real-supporter-permanent',p_order,gen_random_uuid());
  update public.upgrade_credit_reservations set expires_at = now() - interval '1 minute'
  where order_id = p_order;
end; $$;

create or replace function pg_temp.st(p_order uuid) returns text language sql as $$
  select state from public.upgrade_credit_reservations where order_id = p_order;
$$;

-- ===========================================================================
-- CASE A: THE DANGEROUS ONE. Stripe is PAID. We are still 'pending'. Expired.
-- ===========================================================================
select pg_temp.src('b9100000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000001');
select pg_temp.pending_upgrade('b9200000-0000-4000-8000-000000000001',
  'b9000000-0000-4000-8000-000000000001','cs_paid_delayed', interval '-10 minutes');

select is((select status::text from public.orders where id='b9200000-0000-4000-8000-000000000001'),
  'pending', 'the order is still PENDING — the webhook has not arrived');
select ok((select stripe_session_expires_at from public.checkout_attempt_for_order(
  'b9200000-0000-4000-8000-000000000001')) < now(),
  'and the configured session expiry has already passed');

-- The database-only sweep runs during this window.
select public.expire_stale_upgrade_reservations();
select is(pg_temp.st('b9200000-0000-4000-8000-000000000001'), 'reserved',
  'THE SWEEP DOES NOT RELEASE: a configured expiry is not proof the session went unpaid');

-- Reconciliation asks Stripe, which says the session completed and was paid.
select is((select outcome from public.apply_upgrade_reconciliation(
  (select id from public.upgrade_credit_reservations where order_id='b9200000-0000-4000-8000-000000000001'),
  'paid','cs_paid_delayed')), 'held_payment_succeeded',
  'reconciliation holds the reservation when Stripe reports payment');
select is(pg_temp.st('b9200000-0000-4000-8000-000000000001'), 'reserved', 'still held after reconciliation');

-- The delayed webhook finally arrives.
select public.fulfill_paid_order_with_outbox('b9200000-0000-4000-8000-000000000001','pi_delayed','ch_delayed',null);
select is(pg_temp.st('b9200000-0000-4000-8000-000000000001'), 'consumed',
  'the delayed webhook consumes the reservation normally');
select is((select count(*)::integer from public.upgrade_credit_reservations
  where order_id='b9200000-0000-4000-8000-000000000001' and state='consumed'), 1,
  'consumed exactly once');
select ok(exists(select 1 from public.entitlements
  where user_id='b9000000-0000-4000-8000-000000000001'
    and entitlement_key='product:real-supporter-permanent' and status='active'),
  'and the discounted rank is granted correctly');

-- ===========================================================================
-- CASE B: genuinely expired and UNPAID -> reconciliation releases
-- ===========================================================================
select pg_temp.src('b9100000-0000-4000-8000-000000000002','b9000000-0000-4000-8000-000000000002');
select pg_temp.pending_upgrade('b9200000-0000-4000-8000-000000000002',
  'b9000000-0000-4000-8000-000000000002','cs_expired_unpaid', interval '-10 minutes');

select public.expire_stale_upgrade_reservations();
select is(pg_temp.st('b9200000-0000-4000-8000-000000000002'), 'reserved',
  'the sweep alone still does not release a session-backed hold');

select is((select outcome from public.apply_upgrade_reconciliation(
  (select id from public.upgrade_credit_reservations where order_id='b9200000-0000-4000-8000-000000000002'),
  'expired_unpaid','cs_expired_unpaid')), 'released_expired_unpaid',
  'reconciliation releases when Stripe proves the session expired unpaid');
select is(pg_temp.st('b9200000-0000-4000-8000-000000000002'), 'released', 'the credit is available again');
select is((select status::text from public.orders where id='b9200000-0000-4000-8000-000000000002'),
  'cancelled', 'and the order is cancelled through the existing terminal path');

-- Repeated reconciliation is idempotent.
select is((select outcome from public.apply_upgrade_reconciliation(
  (select id from public.upgrade_credit_reservations where order_id='b9200000-0000-4000-8000-000000000002'),
  'expired_unpaid','cs_expired_unpaid')), 'already_released',
  'repeated reconciliation is a no-op');

-- ===========================================================================
-- CASE C: async payment still pending -> never released
-- ===========================================================================
select pg_temp.src('b9100000-0000-4000-8000-000000000003','b9000000-0000-4000-8000-000000000003');
select pg_temp.pending_upgrade('b9200000-0000-4000-8000-000000000003',
  'b9000000-0000-4000-8000-000000000003','cs_async', interval '-10 minutes');

select is((select outcome from public.apply_upgrade_reconciliation(
  (select id from public.upgrade_credit_reservations where order_id='b9200000-0000-4000-8000-000000000003'),
  'async_pending','cs_async')), 'held_payment_pending',
  'a pending async payment holds the reservation');
select is(pg_temp.st('b9200000-0000-4000-8000-000000000003'), 'reserved', 'still reserved');

-- ===========================================================================
-- CASE D: unknown provider state -> never released
-- ===========================================================================
select pg_temp.src('b9100000-0000-4000-8000-000000000004','b9000000-0000-4000-8000-000000000004');
select pg_temp.pending_upgrade('b9200000-0000-4000-8000-000000000004',
  'b9000000-0000-4000-8000-000000000004','cs_unknown', interval '-10 minutes');

select is((select outcome from public.apply_upgrade_reconciliation(
  (select id from public.upgrade_credit_reservations where order_id='b9200000-0000-4000-8000-000000000004'),
  'provider_unreachable','cs_unknown')), 'held_unknown_provider_state',
  'an unreachable provider NEVER releases the credit');
select is(pg_temp.st('b9200000-0000-4000-8000-000000000004'), 'reserved', 'still reserved');

-- ===========================================================================
-- TEMPORARY POLICY: store-credit-funded sources are ineligible
-- ===========================================================================
insert into auth.users (id,email) values ('b9000000-0000-4000-8000-000000000009','d9@example.test') on conflict do nothing;
insert into public.profiles (id,email) values ('b9000000-0000-4000-8000-000000000009','d9@example.test') on conflict do nothing;
insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
  subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('b9100000-0000-4000-8000-000000000009','b9000000-0000-4000-8000-000000000009','d@e.test','T','stripe','pending',
  1299,0,1299,500,799,'USD');
insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
select 'b9100000-0000-4000-8000-000000000009',id,'{"slug":"realvip-permanent"}'::jsonb,1,1299,1299
from public.products where slug='realvip-permanent';
select public.fulfill_paid_order('b9100000-0000-4000-8000-000000000009');

select is((select reason from public.compute_upgrade_price(
  'b9000000-0000-4000-8000-000000000009','real-supporter-permanent')), 'upgrade_credit_unavailable',
  'a store-credit-funded RealVIP is TEMPORARILY ineligible (no tender provenance yet)');

select * from finish();
rollback;
