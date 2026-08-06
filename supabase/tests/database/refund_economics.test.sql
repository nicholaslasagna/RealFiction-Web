-- Refund ceilings, per tender, on the exact order the owner specified:
--
--   merchandise subtotal   3499   list value; nobody ever collected it
--   upgrade discount      -1299   an entitlement, not money
--   order total            2200
--   store credit           -500   our own liability, collected earlier
--   Stripe payment         1700   the only externally collected money
--
-- Three of those five numbers look refundable and only two are, each with its
-- own ceiling and its own tender. Getting this wrong pays a customer for an
-- entitlement they still hold, or leaves them 500 short and told otherwise.

begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

update public.products set active = true
where slug in ('realvip-permanent','real-supporter-permanent');

insert into auth.users (id,email) values
  ('f1000000-0000-4000-8000-000000000001','m1@e.test'),
  ('f1000000-0000-4000-8000-000000000002','m2@e.test'),
  ('f1000000-0000-4000-8000-000000000003','m3@e.test'),
  ('f1000000-0000-4000-8000-000000000004','m4@e.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like 'f1000000%' on conflict do nothing;

-- The order under test, fulfilled: 3499 / -1299 / 2200 / -500 / 1700.
create or replace function pg_temp.mixed(p_order uuid, p_user uuid) returns void language plpgsql as $$
declare v_pid uuid;
begin
  select id into v_pid from public.products where slug='real-supporter-permanent';
  insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
    subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
  values (p_order,p_user,'m@e.test','T','stripe','pending',3499,1299,2200,500,1700,'USD');
  insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
  values (p_order,v_pid,'{"slug":"real-supporter-permanent"}'::jsonb,1,3499,3499);
  insert into public.store_credit_ledger (user_id,delta_cents,source,source_ref,idempotency_key,note)
  values (p_user,500,'manual_grant','seed','seed:'||p_order::text,'seed');
  insert into public.store_credit_ledger (user_id,delta_cents,source,source_ref,idempotency_key,note)
  values (p_user,-500,'store_purchase_spend',p_order::text,'store_credit_spend:'||p_order::text,'spend');
  perform public.fulfill_paid_order(p_order);
end; $$;

create or replace function pg_temp.state(p_order uuid, p_field text)
returns bigint language plpgsql as $$
declare v record; begin
  select * into v from public.order_refund_state(p_order);
  return case p_field
    when 'ext_paid' then v.external_paid_cents
    when 'sc_paid' then v.store_credit_paid_cents
    when 'ext_ref' then v.external_refunded_cents
    when 'sc_ref' then v.store_credit_restored_cents
    when 'ext_left' then v.external_remaining_cents
    when 'sc_left' then v.store_credit_remaining_cents
    when 'economic' then v.economic_refunded_cents
    when 'subtotal' then v.merchandise_subtotal_cents
    when 'discount' then v.upgrade_discount_cents
    when 'total' then v.order_total_cents
  end;
end; $$;

create or replace function pg_temp.balance(p_user uuid) returns bigint language sql as $$
  select coalesce(sum(delta_cents),0) from public.store_credit_ledger where user_id = p_user;
$$;

-- ===========================================================================
-- 1. The ceilings are read from what was COLLECTED, per tender
-- ===========================================================================
select pg_temp.mixed('f1200000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001');

select is(pg_temp.state('f1200000-0000-4000-8000-000000000001','subtotal'), 3499::bigint,
  'the merchandise subtotal is 3499');
select is(pg_temp.state('f1200000-0000-4000-8000-000000000001','discount'), 1299::bigint,
  'the upgrade credit is 1299');
select is(pg_temp.state('f1200000-0000-4000-8000-000000000001','total'), 2200::bigint,
  'the order total is 2200');
select is(pg_temp.state('f1200000-0000-4000-8000-000000000001','ext_paid'), 1700::bigint,
  'the EXTERNAL ceiling is 1700 — not 2200, and certainly not 3499');
select is(pg_temp.state('f1200000-0000-4000-8000-000000000001','sc_paid'), 500::bigint,
  'the STORE CREDIT ceiling is 500');

-- ===========================================================================
-- 2. Excessive, negative, and currency-mismatched inputs FAIL CLOSED
-- ===========================================================================
select is((select outcome from public.record_order_refund(
  'f1200000-0000-4000-8000-000000000001','re_x',3499,'USD',true)), 'exceeds_external_payment',
  'the 3499 subtotal is refused as an external refund');
select is((select outcome from public.record_order_refund(
  'f1200000-0000-4000-8000-000000000001','re_x',2200,'USD',true)), 'exceeds_external_payment',
  'even the 2200 order total is refused — 500 of it was never Stripe money');
select is((select outcome from public.record_order_refund(
  'f1200000-0000-4000-8000-000000000001','re_x',1701,'USD',true)), 'exceeds_external_payment',
  'one cent above the charge is refused');
select is((select outcome from public.record_order_refund(
  'f1200000-0000-4000-8000-000000000001','re_x',-1700,'USD',true)), 'negative_or_missing_amount',
  'a negative refund is refused');
select is((select outcome from public.record_order_refund(
  'f1200000-0000-4000-8000-000000000001','re_x',1700,'EUR',true)), 'currency_mismatch',
  'a refund in another currency is refused');

select is(pg_temp.state('f1200000-0000-4000-8000-000000000001','ext_ref'), 0::bigint,
  'NOTHING was recorded by any of those attempts');
select is((select count(*)::integer from public.order_refunds
  where order_id='f1200000-0000-4000-8000-000000000001'), 0,
  'and no refund row exists');

-- ===========================================================================
-- 3. A partial refund: money only, no store credit, no upgrade restoration
-- ===========================================================================
select is((select outcome from public.record_order_refund(
  'f1200000-0000-4000-8000-000000000001','re_partial',700,'USD',true)), 'recorded',
  'a 700 partial refund is within the 1700 ceiling');
select is(pg_temp.state('f1200000-0000-4000-8000-000000000001','ext_ref'), 700::bigint,
  '700 of external money is reversed');
select is(pg_temp.state('f1200000-0000-4000-8000-000000000001','sc_ref'), 0::bigint,
  'and NO store credit is restored — a partial refund cannot say which tender it came from');
select is((select is_full_economic_refund from public.order_refund_state(
  'f1200000-0000-4000-8000-000000000001')), false,
  'a partial refund is not a full economic refund');

-- The remaining ceiling shrinks; it never resets.
select is(pg_temp.state('f1200000-0000-4000-8000-000000000001','ext_left'), 1000::bigint,
  'only 1000 of external money remains refundable');
select is((select outcome from public.record_order_refund(
  'f1200000-0000-4000-8000-000000000001','re_over',1700,'USD',true)), 'exceeds_external_payment',
  'a second 1700 refund cannot exceed what is left');

-- ===========================================================================
-- 4. Completing the refund restores store credit — bounded at 500
-- ===========================================================================
select is((select outcome from public.record_order_refund(
  'f1200000-0000-4000-8000-000000000001','re_rest',1000,'USD',true)), 'recorded',
  'the remaining 1000 completes the external reversal');
select is(pg_temp.state('f1200000-0000-4000-8000-000000000001','ext_ref'), 1700::bigint,
  'external refunded totals exactly 1700');
select is(pg_temp.state('f1200000-0000-4000-8000-000000000001','sc_ref'), 500::bigint,
  'and exactly 500 of store credit is restored — never more');
select is(pg_temp.state('f1200000-0000-4000-8000-000000000001','economic'), 2200::bigint,
  'the combined economic refund is 2200: the order total, not the 3499 subtotal');
select is((select is_full_economic_refund from public.order_refund_state(
  'f1200000-0000-4000-8000-000000000001')), true,
  'both tenders are whole, so this IS a full economic refund');

select is(pg_temp.balance('f1000000-0000-4000-8000-000000000001'), 500::bigint,
  'the customer actually has their 500 of store credit back');

-- ===========================================================================
-- 5. Ceilings survive repeated webhook processing
-- ===========================================================================
select is((select outcome from public.record_order_refund(
  'f1200000-0000-4000-8000-000000000001','re_rest',1000,'USD',true)), 'duplicate',
  'a replayed refund event is a no-op');
select is(pg_temp.state('f1200000-0000-4000-8000-000000000001','ext_ref'), 1700::bigint,
  'the external total is unchanged by the replay');
select is(pg_temp.state('f1200000-0000-4000-8000-000000000001','sc_ref'), 500::bigint,
  'the store-credit total is unchanged by the replay');
select is(pg_temp.balance('f1000000-0000-4000-8000-000000000001'), 500::bigint,
  'and no second restoration reached the ledger');
select is((select outcome from public.record_order_refund(
  'f1200000-0000-4000-8000-000000000001','re_after',1,'USD',true)), 'exceeds_external_payment',
  'a fully refunded order has no external headroom left at all');

-- ===========================================================================
-- 6. A Stripe-only refund is NOT a complete economic refund
-- ===========================================================================
-- The owner's exact scenario: 1700 back through Stripe, 500 of store credit
-- still outstanding. It must not read as "fully refunded".
select pg_temp.mixed('f1200000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000002');
select is((select outcome from public.record_order_refund(
  'f1200000-0000-4000-8000-000000000002','re_ext_only',1700,'USD',false)), 'recorded',
  'the external 1700 is reversed');
select is(pg_temp.state('f1200000-0000-4000-8000-000000000002','sc_ref'), 0::bigint,
  'but the 500 of store credit was not restored');
select is((select is_full_economic_refund from public.order_refund_state(
  'f1200000-0000-4000-8000-000000000002')), false,
  'A STRIPE-ONLY 1700 WITH 500 OUTSTANDING IS NOT A COMPLETE ECONOMIC REFUND');
select is(pg_temp.state('f1200000-0000-4000-8000-000000000002','economic'), 1700::bigint,
  'the economic reversal is 1700, short of the 2200 order total');

-- ===========================================================================
-- 7. An order with NO store credit: the two ceilings coincide
-- ===========================================================================
insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
  subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('f1200000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000003',
  'm@e.test','T','stripe','fulfilled',3499,1299,2200,0,2200,'USD');

select is(pg_temp.state('f1200000-0000-4000-8000-000000000003','ext_paid'), 2200::bigint,
  'with no store credit the external ceiling is the whole 2200');
select is((select outcome from public.record_order_refund(
  'f1200000-0000-4000-8000-000000000003','re_full',2200,'USD',true)), 'recorded',
  'and 2200 is refundable');
select is((select is_full_economic_refund from public.order_refund_state(
  'f1200000-0000-4000-8000-000000000003')), true, 'which is a full economic refund');
select is((select outcome from public.record_order_refund(
  'f1200000-0000-4000-8000-000000000003','re_more',1299,'USD',true)), 'exceeds_external_payment',
  'the 1299 upgrade credit is still not refundable as money on top of it');

-- ===========================================================================
-- 8. A store-credit-only order has NO external refundable value
-- ===========================================================================
insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
  subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('f1200000-0000-4000-8000-000000000004','f1000000-0000-4000-8000-000000000004',
  'm@e.test','T','gift_card','fulfilled',3499,0,3499,3499,0,'USD');

select is(pg_temp.state('f1200000-0000-4000-8000-000000000004','ext_paid'), 0::bigint,
  'a store-credit-only order collected nothing externally');
select is((select outcome from public.record_order_refund(
  'f1200000-0000-4000-8000-000000000004','re_sc',1,'USD',true)), 'exceeds_external_payment',
  'so not one cent may be refunded through Stripe');

select * from finish();
rollback;
