-- Cancellation safety: a local cancel must never release payment-dependent
-- state while Stripe may already hold the money.

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

update public.products set active = true
where slug in ('realvip-permanent','real-supporter-permanent');

insert into auth.users (id,email) values
  ('c8000000-0000-4000-8000-000000000001','x1@e.test'),
  ('c8000000-0000-4000-8000-000000000002','x2@e.test'),
  ('c8000000-0000-4000-8000-000000000003','x3@e.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like 'c8000000%' on conflict do nothing;

create or replace function pg_temp.src(p_order uuid, p_user uuid) returns void language plpgsql as $$
declare v_pid uuid;
begin
  select id into v_pid from public.products where slug='realvip-permanent';
  insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
    subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
  values (p_order,p_user,'x@e.test','T','stripe','pending',1299,0,1299,0,1299,'USD');
  insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
  values (p_order,v_pid,'{"slug":"realvip-permanent"}'::jsonb,1,1299,1299);
  perform public.fulfill_paid_order(p_order);
end; $$;

create or replace function pg_temp.upg(p_order uuid, p_user uuid, p_session text) returns void language plpgsql as $$
declare v_pid uuid;
begin
  select id into v_pid from public.products where slug='real-supporter-permanent';
  insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
    subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
  values (p_order,p_user,'x@e.test','T','stripe','pending',3499,1299,2200,0,2200,'USD');
  insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
  values (p_order,v_pid,'{"slug":"real-supporter-permanent"}'::jsonb,1,3499,3499);
  insert into public.checkout_attempts (user_id,attempt_id,cart_fingerprint,order_id,
    stripe_session_id,stripe_session_expires_at)
  values (p_user,gen_random_uuid(),'c-'||p_order::text,p_order,p_session,
    case when p_session is null then null else now() + interval '30 minutes' end);
  perform public.reserve_upgrade_credit(p_user,'real-supporter-permanent',p_order,gen_random_uuid());
end; $$;

create or replace function pg_temp.st(p_order uuid) returns text language sql as $$
  select state from public.upgrade_credit_reservations where order_id = p_order;
$$;

-- CASE 1: cancel BEFORE any session exists -> safe to release ---------------
select pg_temp.src('c8100000-0000-4000-8000-000000000001','c8000000-0000-4000-8000-000000000001');
select pg_temp.upg('c8200000-0000-4000-8000-000000000001','c8000000-0000-4000-8000-000000000001', null);
select is((select outcome from public.request_order_cancellation(
  'c8200000-0000-4000-8000-000000000001','user_requested')), 'cancelled_no_provider_session',
  'no session -> cancellation completes immediately');
select is(pg_temp.st('c8200000-0000-4000-8000-000000000001'), 'released',
  'and the hold is released, because nothing could have been charged');
select is((select status::text from public.orders where id='c8200000-0000-4000-8000-000000000001'),
  'cancelled', 'the order is terminally cancelled');

-- CASE 2: THE DANGEROUS ONE. Stripe PAID, we are pending, user cancels ------
select pg_temp.src('c8100000-0000-4000-8000-000000000002','c8000000-0000-4000-8000-000000000002');
select pg_temp.upg('c8200000-0000-4000-8000-000000000002','c8000000-0000-4000-8000-000000000002','cs_paid');

select is((select outcome from public.request_order_cancellation(
  'c8200000-0000-4000-8000-000000000002','user_requested')),
  'cancellation_requested_pending_reconciliation',
  'with a session present, cancellation is only a REQUEST');
select is(pg_temp.st('c8200000-0000-4000-8000-000000000002'), 'reserved',
  'THE HOLD IS RETAINED — Stripe may already have the money');
select is((select status::text from public.orders where id='c8200000-0000-4000-8000-000000000002'),
  'pending', 'the order stays pending until a provider verdict');
select ok((select cancellation_requested_at from public.orders
  where id='c8200000-0000-4000-8000-000000000002') is not null,
  'the request is recorded for reconciliation');

-- Repeating it changes nothing.
select is((select outcome from public.request_order_cancellation(
  'c8200000-0000-4000-8000-000000000002','user_requested')),
  'cancellation_requested_pending_reconciliation', 'repeated cancellation is idempotent');

-- It is surfaced for reconciliation.
select ok(exists(select 1 from public.upgrade_reservations_needing_reconciliation(50)
  where order_id='c8200000-0000-4000-8000-000000000002' and requested_cancel),
  'the order is queued for reconciliation with the cancel flag');

-- Stripe says PAID: cancellation must NOT complete, fulfilment proceeds.
select is((select outcome from public.apply_upgrade_reconciliation(
  (select id from public.upgrade_credit_reservations where order_id='c8200000-0000-4000-8000-000000000002'),
  'paid','cs_paid')), 'held_payment_succeeded',
  'a paid session prevents cancellation');
select public.fulfill_paid_order_with_outbox('c8200000-0000-4000-8000-000000000002','pi_c','ch_c',null);
select is(pg_temp.st('c8200000-0000-4000-8000-000000000002'), 'consumed',
  'the delayed webhook still consumes the reservation — nothing was lost');

-- CASE 3: reconciliation proves expired+unpaid -> cancellation completes ----
select pg_temp.src('c8100000-0000-4000-8000-000000000003','c8000000-0000-4000-8000-000000000003');
select pg_temp.upg('c8200000-0000-4000-8000-000000000003','c8000000-0000-4000-8000-000000000003','cs_dead');
select public.request_order_cancellation('c8200000-0000-4000-8000-000000000003','user_requested');

select is((select outcome from public.apply_upgrade_reconciliation(
  (select id from public.upgrade_credit_reservations where order_id='c8200000-0000-4000-8000-000000000003'),
  'expired_unpaid','cs_dead')), 'released_expired_unpaid',
  'a proven-dead session completes the cancellation');
select is(pg_temp.st('c8200000-0000-4000-8000-000000000003'), 'released', 'the hold is released');
select is((select status::text from public.orders where id='c8200000-0000-4000-8000-000000000003'),
  'cancelled', 'and the order finally reaches cancelled');

select * from finish();
rollback;
