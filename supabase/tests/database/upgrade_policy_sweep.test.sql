-- Owner-approved upgrade policy + sweep safety.
-- The headline: a delayed webhook must NEVER lose its reservation.

begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- The availability gate ships these INACTIVE on purpose. Enabling them here is
-- exactly the operator step Nicholas must perform after approving prices, and
-- proves the gate is what controls sale availability.
update public.products set active = true
where slug in ('realvip-permanent','real-supporter-permanent','username-colors-permanent',
               'particle-vault-permanent','realpets-permanent','cosmetic-atelier-permanent');

insert into auth.users (id,email) values
  ('f1000000-0000-4000-8000-000000000001','p1@example.test'),
  ('f1000000-0000-4000-8000-000000000002','p2@example.test'),
  ('f1000000-0000-4000-8000-000000000003','p3@example.test'),
  ('f1000000-0000-4000-8000-000000000004','p4@example.test') on conflict do nothing;
insert into public.profiles (id,email)
select id, email from auth.users where id::text like 'f1000000%' on conflict do nothing;

-- Buy + fulfil, with configurable tender split.
create or replace function pg_temp.buy(p_order uuid, p_user uuid, p_slug text,
  p_credit bigint default 0, p_gift text default null)
returns uuid language plpgsql as $$
declare v_pid uuid; v_price bigint;
begin
  select id, price_cents into v_pid, v_price from public.products where slug = p_slug;
  insert into public.orders (id,user_id,buyer_email,minecraft_username,minecraft_uuid,provider,status,
    subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency,
    gifted_to_minecraft_username)
  values (p_order,p_user,'p@example.test','T','00000000-0000-4000-8000-00000000bbbb','stripe','pending',
    v_price,0,v_price,p_credit,v_price-p_credit,'USD',p_gift);
  insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
  values (p_order,v_pid,jsonb_build_object('slug',p_slug),1,v_price,v_price);
  perform public.fulfill_paid_order(p_order);
  return p_order;
end; $$;

create or replace function pg_temp.st(p_order uuid) returns text language sql as $$
  select state from public.upgrade_credit_reservations where order_id = p_order;
$$;

-- ===== POLICY: store-credit-funded RealVIP IS eligible =======================
select pg_temp.buy('a2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001',
  'realvip-permanent', 500);  -- $5 of $12.99 paid with store credit
select is((select eligible from public.compute_upgrade_price(
  'f1000000-0000-4000-8000-000000000001','real-supporter-permanent')), true,
  'a partly store-credit-funded RealVIP IS eligible');
select is((select credit_cents from public.compute_upgrade_price(
  'f1000000-0000-4000-8000-000000000001','real-supporter-permanent')), 1299::bigint,
  'credit is the full ITEM value regardless of tender');

select pg_temp.buy('a2000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000002',
  'realvip-permanent', 1299);  -- entirely store credit
select is((select credit_cents from public.compute_upgrade_price(
  'f1000000-0000-4000-8000-000000000002','real-supporter-permanent')), 1299::bigint,
  'an entirely store-credit-funded RealVIP still grants full item credit');

-- Gift source is ineligible.
select pg_temp.buy('a2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000003',
  'realvip-permanent', 0, 'SomeoneElse');
select is((select reason from public.compute_upgrade_price(
  'f1000000-0000-4000-8000-000000000003','real-supporter-permanent')), 'upgrade_credit_unavailable',
  'a GIFT purchase is still ineligible');

-- Manual/inclusion-sourced entitlement is ineligible (no paid order item).
insert into public.entitlements (user_id,minecraft_username,entitlement_key,status,starts_at,metadata)
values ('f1000000-0000-4000-8000-000000000004','T4','product:realvip-permanent','active',now(),
  '{"source":"manual_grant"}'::jsonb);
select is((select reason from public.compute_upgrade_price(
  'f1000000-0000-4000-8000-000000000004','real-supporter-permanent')), 'upgrade_credit_unavailable',
  'a MANUAL grant funds no upgrade');

-- ===== SWEEP SAFETY ==========================================================
create or replace function pg_temp.mk_pending(p_order uuid, p_user uuid) returns void language plpgsql as $$
declare v_pid uuid; v_price bigint;
begin
  select id, price_cents into v_pid, v_price from public.products where slug='real-supporter-permanent';
  insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
    subtotal_cents,discount_cents,total_cents,payment_due_cents,currency)
  values (p_order,p_user,'p@example.test','T','stripe','pending',v_price,0,v_price,v_price,'USD');
  insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
  values (p_order,v_pid,'{"slug":"real-supporter-permanent"}'::jsonb,1,v_price,v_price);
  insert into public.checkout_attempts (user_id,attempt_id,cart_fingerprint,order_id)
  values (p_user,gen_random_uuid(),'cart-'||p_order::text,p_order);
end; $$;

-- CASE 1: Checkout COMPLETED but webhook delayed. Order is paid.
select pg_temp.mk_pending('a3000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001');
select public.reserve_upgrade_credit('f1000000-0000-4000-8000-000000000001','real-supporter-permanent',
  'a3000000-0000-4000-8000-000000000001', gen_random_uuid());
update public.upgrade_credit_reservations set expires_at = now() - interval '5 hours'
where order_id='a3000000-0000-4000-8000-000000000001';
-- Payment succeeded; the webhook has not arrived yet.
update public.orders set status='paid' where id='a3000000-0000-4000-8000-000000000001';
select public.expire_stale_upgrade_reservations();
select is(pg_temp.st('a3000000-0000-4000-8000-000000000001'), 'reserved',
  'a PAID order keeps its reservation however stale — a delayed webhook cannot lose it');

-- ...and fulfilment still consumes it correctly.
select public.fulfill_paid_order_with_outbox('a3000000-0000-4000-8000-000000000001','pi_d','ch_d',null);
select is(pg_temp.st('a3000000-0000-4000-8000-000000000001'), 'consumed',
  'the delayed webhook then consumes it normally');

-- CASE 2: Unpaid, Stripe session authoritatively EXPIRED -> safe to release.
select pg_temp.buy('a2000000-0000-4000-8000-000000000010','f1000000-0000-4000-8000-000000000002','realvip-permanent');
select pg_temp.mk_pending('a3000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000002');
select public.reserve_upgrade_credit('f1000000-0000-4000-8000-000000000002','real-supporter-permanent',
  'a3000000-0000-4000-8000-000000000002', gen_random_uuid());
update public.checkout_attempts
set stripe_session_id='cs_expired', stripe_session_expires_at = now() - interval '10 minutes'
where order_id='a3000000-0000-4000-8000-000000000002';
update public.upgrade_credit_reservations set expires_at = now() - interval '1 minute'
where order_id='a3000000-0000-4000-8000-000000000002';
select public.expire_stale_upgrade_reservations();
select is(pg_temp.st('a3000000-0000-4000-8000-000000000002'), 'released',
  'an unpaid order whose Stripe session expired releases safely');

-- CASE 3: Unpaid, session still VALID -> must NOT release.
select pg_temp.buy('a2000000-0000-4000-8000-000000000020','f1000000-0000-4000-8000-000000000003','realvip-permanent');
update public.orders set gifted_to_minecraft_username = null where id='a2000000-0000-4000-8000-000000000003';
select pg_temp.mk_pending('a3000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000003');
select public.reserve_upgrade_credit('f1000000-0000-4000-8000-000000000003','real-supporter-permanent',
  'a3000000-0000-4000-8000-000000000003', gen_random_uuid());
update public.checkout_attempts
set stripe_session_id='cs_live', stripe_session_expires_at = now() + interval '30 minutes'
where order_id='a3000000-0000-4000-8000-000000000003';
update public.upgrade_credit_reservations set expires_at = now() - interval '1 minute'
where order_id='a3000000-0000-4000-8000-000000000003';
select public.expire_stale_upgrade_reservations();
select is(pg_temp.st('a3000000-0000-4000-8000-000000000003'), 'reserved',
  'a session the customer can still pay keeps its reservation');

-- CASE 4: Unknown state (no session, attempt still open) -> not released.
select pg_temp.buy('a2000000-0000-4000-8000-000000000030','f1000000-0000-4000-8000-000000000004','realvip-permanent');
select pg_temp.mk_pending('a3000000-0000-4000-8000-000000000004','f1000000-0000-4000-8000-000000000004');
select public.reserve_upgrade_credit('f1000000-0000-4000-8000-000000000004','real-supporter-permanent',
  'a3000000-0000-4000-8000-000000000004', gen_random_uuid());
update public.upgrade_credit_reservations set expires_at = now() - interval '1 minute'
where order_id='a3000000-0000-4000-8000-000000000004';
select public.expire_stale_upgrade_reservations();
select is(pg_temp.st('a3000000-0000-4000-8000-000000000004'), 'reserved',
  'unknown provider state does NOT release — insufficient evidence');

-- ...and after 24h of ambiguity it goes to review, never silently released.
update public.upgrade_credit_reservations set expires_at = now() - interval '30 hours'
where order_id='a3000000-0000-4000-8000-000000000004';
select public.expire_stale_upgrade_reservations();
select is(pg_temp.st('a3000000-0000-4000-8000-000000000004'), 'needs_review',
  'long-ambiguous holds go to REVIEW, not to release');

-- Repeated sweeps are stable.
select public.expire_stale_upgrade_reservations();
select is(pg_temp.st('a3000000-0000-4000-8000-000000000003'), 'reserved',
  'repeated sweeps do not drift');

-- ===== REFUND POLICY =========================================================
-- Full refund of the upgraded order RESTORES the credit (owner policy).
select is((select outcome from public.restore_upgrade_credit_after_refund(
  'a3000000-0000-4000-8000-000000000001', true, false)), 'target_still_active',
  'restoration waits while the upgraded rank is still active — it does not strand the credit');

update public.entitlements set status='revoked'
where user_id='f1000000-0000-4000-8000-000000000001'
  and entitlement_key='product:real-supporter-permanent';
select is((select restored from public.restore_upgrade_credit_after_refund(
  'a3000000-0000-4000-8000-000000000001', true, false)), true,
  'a FULL refund with the rank revoked and a valid source RESTORES the credit');
select is(pg_temp.st('a3000000-0000-4000-8000-000000000001'), 'released',
  'the SAME reservation returns to available — no second credit');
select is((select count(*)::integer from public.upgrade_credit_reservations
  where source_order_item_id = (select id from public.order_items
    where order_id='a2000000-0000-4000-8000-000000000001')), 1,
  'restoration creates no duplicate credit row');

-- The restored credit can be reserved once more.
select pg_temp.mk_pending('a3000000-0000-4000-8000-000000000009','f1000000-0000-4000-8000-000000000001');
select is((select reserved from public.reserve_upgrade_credit(
  'f1000000-0000-4000-8000-000000000001','real-supporter-permanent',
  'a3000000-0000-4000-8000-000000000009', gen_random_uuid())), true,
  'the restored credit is usable again exactly once');

-- Partial refund does NOT restore.
select public.fulfill_paid_order_with_outbox('a3000000-0000-4000-8000-000000000009',null,null,null);
select is((select outcome from public.restore_upgrade_credit_after_refund(
  'a3000000-0000-4000-8000-000000000009', false, false)), 'partial_refund_needs_review',
  'a PARTIAL refund never auto-restores');

-- Chargeback does NOT restore. (Fresh consumed reservation: the partial-refund
-- call above already moved that one to review.)
select pg_temp.buy('a2000000-0000-4000-8000-000000000200','f1000000-0000-4000-8000-000000000003','realvip-permanent');
select pg_temp.mk_pending('a3000000-0000-4000-8000-000000000200','f1000000-0000-4000-8000-000000000003');
select public.reserve_upgrade_credit('f1000000-0000-4000-8000-000000000003','real-supporter-permanent',
  'a3000000-0000-4000-8000-000000000200', gen_random_uuid());
select public.fulfill_paid_order_with_outbox('a3000000-0000-4000-8000-000000000200',null,null,null);
select is((select outcome from public.restore_upgrade_credit_after_refund(
  'a3000000-0000-4000-8000-000000000200', true, true)), 'chargeback_needs_review',
  'a CHARGEBACK never auto-restores');

-- ===== SOURCE REFUND DEPENDENCY =============================================
-- A FRESH user, so the reservation provably sources from this exact purchase
-- (users above hold several equally-valued eligible lines).
insert into auth.users (id,email) values ('f1000000-0000-4000-8000-000000000009','p9@example.test') on conflict do nothing;
insert into public.profiles (id,email) values ('f1000000-0000-4000-8000-000000000009','p9@example.test') on conflict do nothing;
select pg_temp.buy('a2000000-0000-4000-8000-000000000100','f1000000-0000-4000-8000-000000000009','realvip-permanent');
select pg_temp.mk_pending('a3000000-0000-4000-8000-000000000100','f1000000-0000-4000-8000-000000000009');
select public.reserve_upgrade_credit('f1000000-0000-4000-8000-000000000009','real-supporter-permanent',
  'a3000000-0000-4000-8000-000000000100', gen_random_uuid());
select public.fulfill_paid_order_with_outbox('a3000000-0000-4000-8000-000000000100',null,null,null);

select is((select flagged from public.flag_source_refund_dependency(
  'a2000000-0000-4000-8000-000000000100','evt_src_refund_1','refund')), true,
  'refunding the SOURCE after its credit was spent is flagged');
select is((select count(*)::integer from public.payment_reviews
  where reason='upgrade_source_refund_dependency'), 1,
  'a high-priority payment review records the dependency');
select is((select detail->>'priority' from public.payment_reviews
  where reason='upgrade_source_refund_dependency'), 'high',
  'the review is high priority');
select ok((select detail ? 'upgraded_order_id' and detail ? 'dependent_entitlement_key'
  from public.payment_reviews where reason='upgrade_source_refund_dependency'),
  'the review names the dependent order and entitlement');

-- Replaying the same event creates no duplicate review.
select public.flag_source_refund_dependency('a2000000-0000-4000-8000-000000000100','evt_src_refund_1','refund');
select is((select count(*)::integer from public.payment_reviews
  where reason='upgrade_source_refund_dependency'), 1,
  'replayed source-refund events are idempotent');

select * from finish();
rollback;
