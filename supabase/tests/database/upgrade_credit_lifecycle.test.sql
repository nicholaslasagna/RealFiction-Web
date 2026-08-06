-- Upgrade credit: RESERVED at checkout, CONSUMED only inside successful
-- fulfilment, RELEASED on every failure path.

begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- The availability gate ships the new SKUs INACTIVE. Enabling them here is the
-- operator step Nicholas performs after approving prices; without it nothing is
-- purchasable, which is the gate working as designed.
update public.products set active = true
where slug in ('realvip-permanent','real-supporter-permanent','username-colors-permanent',
               'particle-vault-permanent','realpets-permanent','cosmetic-atelier-permanent');

insert into auth.users (id,email) values
  ('c1000000-0000-4000-8000-000000000001','u1@example.test'),
  ('c1000000-0000-4000-8000-000000000002','u2@example.test') on conflict do nothing;
insert into public.profiles (id,email) values
  ('c1000000-0000-4000-8000-000000000001','u1@example.test'),
  ('c1000000-0000-4000-8000-000000000002','u2@example.test') on conflict do nothing;

-- Helper: a settled purchase of p_slug, fully paid externally.
-- Creates a settled purchase AND actually fulfils it, so a real entitlement
-- exists. Eligibility now requires an order-sourced entitlement (which is what
-- excludes manual grants and inherited ranks), so a fixture that only sets a
-- status is not a valid source.
create or replace function pg_temp.buy(p_order uuid, p_user uuid, p_slug text,
  p_status text default 'fulfilled', p_gift text default null, p_credit bigint default 0)
returns uuid language plpgsql as $$
declare v_pid uuid; v_price bigint;
begin
  select id, price_cents into v_pid, v_price from public.products where slug = p_slug;
  insert into public.orders (id,user_id,buyer_email,minecraft_username,minecraft_uuid,provider,status,
    subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency,
    gifted_to_minecraft_username)
  values (p_order,p_user,'u@example.test','T','00000000-0000-4000-8000-00000000aaaa','stripe','pending',
    v_price,0,v_price,p_credit,v_price-p_credit,'USD',p_gift);
  insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
  values (p_order,v_pid,jsonb_build_object('slug',p_slug),1,v_price,v_price);

  if p_status <> 'pending' then
    perform public.fulfill_paid_order(p_order);
    if p_status <> 'fulfilled' then
      update public.orders set status = p_status::public.order_status where id = p_order;
    end if;
  end if;
  return p_order;
end; $$;

create or replace function pg_temp.state(p_order uuid) returns text language sql as $$
  select state from public.upgrade_credit_reservations where order_id = p_order;
$$;

-- Source RealVIP purchase (fully paid externally).
select pg_temp.buy('d1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','realvip-permanent');

-- 1. Quote is read-only ------------------------------------------------------
select is((select eligible from public.compute_upgrade_price(
  'c1000000-0000-4000-8000-000000000001','real-supporter-permanent')), true, 'a paid RealVIP line is eligible');
select is((select credit_cents from public.compute_upgrade_price(
  'c1000000-0000-4000-8000-000000000001','real-supporter-permanent')), 1299::bigint,
  'credit equals the externally paid line amount');
select is((select count(*)::integer from public.upgrade_credit_reservations), 0,
  'quoting creates NO reservation — it is read-only');

-- 2. Reserve, do not consume -------------------------------------------------
select pg_temp.buy('d1000000-0000-4000-8000-000000000010','c1000000-0000-4000-8000-000000000001',
  'real-supporter-permanent','pending');
select is((select reserved from public.reserve_upgrade_credit(
  'c1000000-0000-4000-8000-000000000001','real-supporter-permanent',
  'd1000000-0000-4000-8000-000000000010','e1000000-0000-4000-8000-000000000001')), true, 'credit reserves');
select is(pg_temp.state('d1000000-0000-4000-8000-000000000010'), 'reserved',
  'a pending order RESERVES — it does not consume');

-- 3. Reserving is idempotent per order ---------------------------------------
select is((select reason from public.reserve_upgrade_credit(
  'c1000000-0000-4000-8000-000000000001','real-supporter-permanent',
  'd1000000-0000-4000-8000-000000000010','e1000000-0000-4000-8000-000000000001')),
  'already_reserved_for_order', 'a retried attempt reuses the same reservation');
select is((select count(*)::integer from public.upgrade_credit_reservations
  where source_order_item_id = (select id from public.order_items
    where order_id='d1000000-0000-4000-8000-000000000001')), 1,
  'retries never stack reservations');

-- 4. A second checkout cannot take a held credit -----------------------------
select pg_temp.buy('d1000000-0000-4000-8000-000000000011','c1000000-0000-4000-8000-000000000001',
  'real-supporter-permanent','pending');
select is((select reason from public.reserve_upgrade_credit(
  'c1000000-0000-4000-8000-000000000001','real-supporter-permanent',
  'd1000000-0000-4000-8000-000000000011','e1000000-0000-4000-8000-000000000002')),
  'upgrade_credit_unavailable', 'a second tab cannot reserve the same credit');

-- 5. Release returns it to available -----------------------------------------
select ok(public.release_upgrade_credit('d1000000-0000-4000-8000-000000000010','stripe_failed'),
  'release succeeds');
select is(pg_temp.state('d1000000-0000-4000-8000-000000000010'), 'released', 'state is released');
select ok(not public.release_upgrade_credit('d1000000-0000-4000-8000-000000000010','again'),
  'release is idempotent');
select is((select reserved from public.reserve_upgrade_credit(
  'c1000000-0000-4000-8000-000000000001','real-supporter-permanent',
  'd1000000-0000-4000-8000-000000000011','e1000000-0000-4000-8000-000000000002')), true,
  'the released credit is available again');

-- 6. Cancelling a pending order releases automatically ------------------------
update public.orders set status='cancelled' where id='d1000000-0000-4000-8000-000000000011';
select is(pg_temp.state('d1000000-0000-4000-8000-000000000011'), 'released',
  'a cancelled pending order releases its reservation');

-- 7. CONSUME only inside successful fulfilment --------------------------------
select pg_temp.buy('d1000000-0000-4000-8000-000000000012','c1000000-0000-4000-8000-000000000001',
  'real-supporter-permanent','pending');
select public.reserve_upgrade_credit('c1000000-0000-4000-8000-000000000001','real-supporter-permanent',
  'd1000000-0000-4000-8000-000000000012','e1000000-0000-4000-8000-000000000003');
select is(pg_temp.state('d1000000-0000-4000-8000-000000000012'), 'reserved', 'still only reserved');

select public.fulfill_paid_order_with_outbox('d1000000-0000-4000-8000-000000000012','pi_1','ch_1',null);
select is(pg_temp.state('d1000000-0000-4000-8000-000000000012'), 'consumed',
  'successful fulfilment CONSUMES the credit');
select ok(exists(select 1 from public.entitlements
  where user_id='c1000000-0000-4000-8000-000000000001'
    and entitlement_key='product:real-supporter-permanent' and status='active'),
  'and the rank is granted in the same transaction');

-- 8. Webhook replay does not consume twice ------------------------------------
select public.fulfill_paid_order_with_outbox('d1000000-0000-4000-8000-000000000012','pi_1','ch_1',null);
select is((select count(*)::integer from public.upgrade_credit_reservations
  where state='consumed'), 1, 'a replayed webhook consumes nothing extra');

-- 9. A consumed source cannot fund a second upgrade ---------------------------
select is((select reason from public.compute_upgrade_price(
  'c1000000-0000-4000-8000-000000000001','real-supporter-permanent')),
  'upgrade_target_already_owned', 'the target is now owned');

-- 10. REFUND DEPENDENCY -------------------------------------------------------
select is((select has_dependency from public.upgrade_dependency_for_order(
  'd1000000-0000-4000-8000-000000000001')), true,
  'refunding the SOURCE VIP is flagged as an upgrade dependency');

-- Reversing the UPGRADED order invalidates (does not return) the credit.
-- Owner policy: a FULL refund of the upgraded order, with the rank revoked and
-- a still-valid source, RESTORES the same credit. It is never duplicated.
update public.entitlements set status='revoked'
where user_id='c1000000-0000-4000-8000-000000000001'
  and entitlement_key='product:real-supporter-permanent';
-- "Fully refunded" is now a MEASURED fact, not a status flag: the money has to
-- have actually gone back through the tenders that collected it.
select public.record_order_refund('d1000000-0000-4000-8000-000000000012', 're_lifecycle',
  (select external_paid_cents from public.order_refund_state('d1000000-0000-4000-8000-000000000012')),
  'USD', true);
update public.orders set status='refunded' where id='d1000000-0000-4000-8000-000000000012';
select is(pg_temp.state('d1000000-0000-4000-8000-000000000012'), 'released',
  'a fully refunded upgrade RESTORES the credit to available');

-- 11. Stale reservations are swept -------------------------------------------
select pg_temp.buy('d1000000-0000-4000-8000-000000000020','c1000000-0000-4000-8000-000000000002','realvip-permanent');
select pg_temp.buy('d1000000-0000-4000-8000-000000000021','c1000000-0000-4000-8000-000000000002',
  'real-supporter-permanent','pending');
select public.reserve_upgrade_credit('c1000000-0000-4000-8000-000000000002','real-supporter-permanent',
  'd1000000-0000-4000-8000-000000000021','e1000000-0000-4000-8000-000000000010');
update public.upgrade_credit_reservations set expires_at = now() - interval '1 minute'
where order_id='d1000000-0000-4000-8000-000000000021';

-- Age ALONE must not release: without evidence the payment path is closed, the
-- hold stays. This is what protects a delayed webhook.
select public.expire_stale_upgrade_reservations();
select is(pg_temp.state('d1000000-0000-4000-8000-000000000021'), 'reserved',
  'age alone does NOT release — evidence is required');

-- With authoritative evidence (Stripe session expired, order still unpaid) it
-- releases safely.
-- A configured expiry is NOT terminal evidence (see delayed_webhook_safety).
-- Only a cancelled order releases a session-backed hold.
insert into public.checkout_attempts (user_id,attempt_id,cart_fingerprint,order_id,
  stripe_session_id,stripe_session_expires_at)
values ('c1000000-0000-4000-8000-000000000002',gen_random_uuid(),'cart-sweep',
  'd1000000-0000-4000-8000-000000000021','cs_gone', now() - interval '5 minutes');
select public.expire_stale_upgrade_reservations();
select is(pg_temp.state('d1000000-0000-4000-8000-000000000021'), 'reserved',
  'a configured expiry alone does not release a session-backed hold');
-- A SESSION-BACKED order does not release on local cancellation: Stripe may
-- already hold the money (see cancellation_safety.test.sql). Only a provider
-- verdict may release it.
update public.orders set status='cancelled' where id='d1000000-0000-4000-8000-000000000021';
select is(pg_temp.state('d1000000-0000-4000-8000-000000000021'), 'reserved',
  'a session-backed cancel does NOT release — reconciliation must decide');
select is((select outcome from public.apply_upgrade_reconciliation(
  (select id from public.upgrade_credit_reservations where order_id='d1000000-0000-4000-8000-000000000021'),
  'expired_unpaid','cs_gone')), 'released_expired_unpaid',
  'a proven-dead session releases it');

-- 12. Ineligible sources ------------------------------------------------------
-- A GIFT purchase grants no upgrade credit.
insert into auth.users (id,email) values ('c1000000-0000-4000-8000-000000000003','u3@example.test') on conflict do nothing;
insert into public.profiles (id,email) values ('c1000000-0000-4000-8000-000000000003','u3@example.test') on conflict do nothing;
select pg_temp.buy('d1000000-0000-4000-8000-000000000030','c1000000-0000-4000-8000-000000000003',
  'realvip-permanent','fulfilled','SomeoneElse');
select is((select reason from public.compute_upgrade_price(
  'c1000000-0000-4000-8000-000000000003','real-supporter-permanent')), 'upgrade_credit_unavailable',
  'a GIFT purchase grants no upgrade credit');

-- A refunded source grants no credit.
insert into auth.users (id,email) values ('c1000000-0000-4000-8000-000000000004','u4@example.test') on conflict do nothing;
insert into public.profiles (id,email) values ('c1000000-0000-4000-8000-000000000004','u4@example.test') on conflict do nothing;
select pg_temp.buy('d1000000-0000-4000-8000-000000000040','c1000000-0000-4000-8000-000000000004',
  'realvip-permanent','refunded');
select is((select reason from public.compute_upgrade_price(
  'c1000000-0000-4000-8000-000000000004','real-supporter-permanent')), 'upgrade_credit_unavailable',
  'a REFUNDED source grants no upgrade credit');

-- Bought entirely with store credit -> no external money -> no credit.
insert into auth.users (id,email) values ('c1000000-0000-4000-8000-000000000005','u5@example.test') on conflict do nothing;
insert into public.profiles (id,email) values ('c1000000-0000-4000-8000-000000000005','u5@example.test') on conflict do nothing;
-- Owner policy: store credit is real customer value (refunds, gift balances),
-- so a store-credit-funded purchase grants the FULL item credit.
select pg_temp.buy('d1000000-0000-4000-8000-000000000050','c1000000-0000-4000-8000-000000000005',
  'realvip-permanent','fulfilled',null,1299);
select is((select reason from public.compute_upgrade_price(
  'c1000000-0000-4000-8000-000000000005','real-supporter-permanent')), 'upgrade_credit_unavailable',
  'a store-credit-funded source is TEMPORARILY ineligible (no tender provenance)');

select * from finish();
rollback;
