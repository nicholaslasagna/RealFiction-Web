-- Claimed gift value funding an ORDINARY purchase, through the real functions
-- the checkout route calls.
--
--   $25.00 claimed -> realvip_3m at $12.99 -> $12.01 remains
--   $5.00  claimed -> realvip_3m at $12.99 -> $7.99 charged through Stripe
--
-- The point of both is the same: once claimed, gift value is just store credit
-- to the rest of the system. The ordinary entitlement, the ordinary stacking
-- rule, and the ordinary RealCore reward are untouched by how it was paid for.

begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users (id,email) values
  ('6a000000-0000-4000-8000-000000000001','r1@e.test'),
  ('6a000000-0000-4000-8000-000000000002','r2@e.test'),
  ('6a000000-0000-4000-8000-000000000003','r3@e.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like '6a000000%' on conflict do nothing;

insert into public.minecraft_account_links (user_id,minecraft_username,minecraft_uuid,verification_code,status,verified_at)
values
  ('6a000000-0000-4000-8000-000000000001','PlayerOne','00000000-0000-4000-8000-0000000000a1','C1','verified',now()),
  ('6a000000-0000-4000-8000-000000000002','PlayerTwo','00000000-0000-4000-8000-0000000000a2','C2','verified',now()),
  ('6a000000-0000-4000-8000-000000000003','PlayerTre','00000000-0000-4000-8000-0000000000a3','C3','verified',now())
on conflict do nothing;

-- A claimed gift card, via the real claim function.
create or replace function pg_temp.claim(p_card uuid, p_user uuid, p_email text, p_cents integer)
returns void language plpgsql as $$
begin
  insert into public.gift_cards (id,original_balance_cents,balance_cents,currency,
    purchaser_user_id,status,recipient_email,public_ref)
  values (p_card,p_cents,p_cents,'USD','6a000000-0000-4000-8000-000000000001','active',p_email,
    'RFG-'||upper(right(replace(p_card::text,'-',''),10)));
  insert into public.gift_card_claim_credentials (gift_card_id,verifier,masked_suffix)
  values (p_card,'verif-'||replace(p_card::text,'-',''),'WXYZ');
  perform public.claim_gift_card('verif-'||replace(p_card::text,'-',''), p_user, p_email);
end; $$;

create or replace function pg_temp.order_for(p_order uuid, p_user uuid, p_user_name text, p_slug text)
returns void language plpgsql as $$
declare v_pid uuid; v_price integer;
begin
  select id, price_cents into v_pid, v_price from public.products where slug = p_slug;
  insert into public.orders (id,user_id,buyer_email,minecraft_username,minecraft_uuid,provider,status,
    subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
  values (p_order,p_user,'r@e.test',p_user_name,
    (select minecraft_uuid from public.minecraft_account_links where user_id=p_user),
    'stripe','pending',v_price,0,v_price,0,v_price,'USD');
  insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
  values (p_order,v_pid,jsonb_build_object('slug',p_slug),1,v_price,v_price);
end; $$;

create or replace function pg_temp.gift_avail(p_user uuid) returns bigint language sql as $$
  select public.gift_origin_available(p_user)
$$;

create or replace function pg_temp.ledger(p_user uuid) returns bigint language sql as $$
  select coalesce(sum(delta_cents),0) from public.store_credit_ledger where user_id = p_user
$$;

create or replace function pg_temp.rewards(p_order uuid) returns bigint language sql as $$
  select count(*) from public.reward_queue rq
  join public.order_items oi on oi.id = rq.source_id where oi.order_id = p_order
$$;

-- ===========================================================================
-- FLOW 1: store-credit-only. $25.00 - $12.99 = $12.01
-- ===========================================================================
select pg_temp.claim('6b000000-0000-4000-8000-000000000001',
  '6a000000-0000-4000-8000-000000000001','r1@e.test',2500);

select is(pg_temp.gift_avail('6a000000-0000-4000-8000-000000000001'), 2500::bigint,
  '$25.00 of gift-origin credit is available after the claim');
select is(pg_temp.ledger('6a000000-0000-4000-8000-000000000001'), 2500::bigint,
  'and the LEDGER agrees — one balance, not two');

select pg_temp.order_for('6c000000-0000-4000-8000-000000000001',
  '6a000000-0000-4000-8000-000000000001','PlayerOne','realvip-3m');

select is((select total_cents from public.orders where id='6c000000-0000-4000-8000-000000000001'), 1299,
  'realvip_3m costs $12.99');

-- The real reservation the checkout route calls.
select ok(public.reserve_store_credit_for_order('6c000000-0000-4000-8000-000000000001',
  '6a000000-0000-4000-8000-000000000001', 1299), 'the server reserves $12.99');
select is((select payment_due_cents from public.orders where id='6c000000-0000-4000-8000-000000000001'), 0,
  'nothing is left to charge externally');
select is((select coalesce(sum(amount_cents),0)::bigint from public.store_credit_lot_allocations
  where order_id='6c000000-0000-4000-8000-000000000001' and state='reserved'), 1299::bigint,
  'and the reservation is allocated against the GIFT-ORIGIN lot specifically');
select is(pg_temp.gift_avail('6a000000-0000-4000-8000-000000000001'), 1201::bigint,
  'held value leaves the available balance immediately');

-- The real store-credit-only completion the route calls.
select ok(public.complete_store_credit_only_order('6c000000-0000-4000-8000-000000000001',
  '6a000000-0000-4000-8000-000000000001'), 'the order completes through the real fulfilment path');

select is(pg_temp.gift_avail('6a000000-0000-4000-8000-000000000001'), 1201::bigint,
  '$25.00 CLAIMED, $12.99 SPENT, $12.01 OF GIFT-ORIGIN CREDIT REMAINS');
select is(pg_temp.ledger('6a000000-0000-4000-8000-000000000001'), 1201::bigint,
  'and the ledger reconciles to the same cent');
select is((select coalesce(sum(amount_cents),0)::bigint from public.store_credit_lot_allocations
  where order_id='6c000000-0000-4000-8000-000000000001' and state='consumed'), 1299::bigint,
  'exactly $12.99 was consumed from that lot');
select is((select source from public.store_credit_lots
  where user_id='6a000000-0000-4000-8000-000000000001'), 'gift_card',
  'the remaining $12.01 is still gift-origin, not generic credit');

-- The ordinary product outcome is completely ordinary.
select is((select status::text from public.orders where id='6c000000-0000-4000-8000-000000000001'),
  'fulfilled', 'the order is fulfilled');
select ok(exists(select 1 from public.entitlements e
  join public.order_items oi on oi.id=e.order_item_id
  where oi.order_id='6c000000-0000-4000-8000-000000000001'
    and e.entitlement_key='product:realvip-3m' and e.status='active'
    and e.expires_at > now() + interval '85 days'
    and e.expires_at < now() + interval '95 days'),
  'the existing THREE-MONTH entitlement rule is applied, unchanged');
select is(pg_temp.rewards('6c000000-0000-4000-8000-000000000001'), 1::bigint,
  'exactly ONE RealCore reward is queued');
select is((select rq.reward_key from public.reward_queue rq
  join public.order_items oi on oi.id=rq.source_id
  where oi.order_id='6c000000-0000-4000-8000-000000000001'), 'store.realvip-3m',
  'with the ordinary product reward key');
select is((select count(*)::integer from public.reward_queue where reward_key ilike '%gift%'), 0,
  'NO gift-card reward exists anywhere');

-- Replay consumes nothing further.
select ok(public.complete_store_credit_only_order('6c000000-0000-4000-8000-000000000001',
  '6a000000-0000-4000-8000-000000000001'), 'replay is an idempotent success');
select is(pg_temp.gift_avail('6a000000-0000-4000-8000-000000000001'), 1201::bigint,
  'and consumes NOTHING further');
select is(pg_temp.rewards('6c000000-0000-4000-8000-000000000001'), 1::bigint,
  'and queues no second reward');

-- ===========================================================================
-- FLOW 2: mixed payment. $12.99 - $5.00 = $7.99 through Stripe
-- ===========================================================================
select pg_temp.claim('6b000000-0000-4000-8000-000000000002',
  '6a000000-0000-4000-8000-000000000002','r2@e.test',500);
select pg_temp.order_for('6c000000-0000-4000-8000-000000000002',
  '6a000000-0000-4000-8000-000000000002','PlayerTwo','realvip-3m');

select ok(public.reserve_store_credit_for_order('6c000000-0000-4000-8000-000000000002',
  '6a000000-0000-4000-8000-000000000002', 500), 'the server reserves the whole $5.00');
select is((select payment_due_cents from public.orders where id='6c000000-0000-4000-8000-000000000002'), 799,
  'STRIPE IS ASKED FOR EXACTLY $7.99 — never the full $12.99');
select is(pg_temp.gift_avail('6a000000-0000-4000-8000-000000000002'), 0::bigint,
  'the $5.00 is held');
select is((select coalesce(sum(amount_cents),0)::bigint from public.store_credit_lot_allocations
  where order_id='6c000000-0000-4000-8000-000000000002' and state='consumed'), 0::bigint,
  'and is NOT consumed before payment is verified');

-- The paid webhook's fulfilment transaction.
select public.fulfill_paid_order_with_outbox('6c000000-0000-4000-8000-000000000002','pi_mix','ch_mix',null);

select is((select coalesce(sum(amount_cents),0)::bigint from public.store_credit_lot_allocations
  where order_id='6c000000-0000-4000-8000-000000000002' and state='consumed'), 500::bigint,
  'verified payment consumes the $5.00 exactly once');
select is(pg_temp.gift_avail('6a000000-0000-4000-8000-000000000002'), 0::bigint,
  'the gift-origin balance is now $0.00');
select is(pg_temp.rewards('6c000000-0000-4000-8000-000000000002'), 1::bigint,
  'one ordinary RealVIP reward is queued');

-- Webhook replay.
select public.fulfill_paid_order_with_outbox('6c000000-0000-4000-8000-000000000002','pi_mix','ch_mix',null);
select is((select coalesce(sum(amount_cents),0)::bigint from public.store_credit_lot_allocations
  where order_id='6c000000-0000-4000-8000-000000000002' and state='consumed'), 500::bigint,
  'a REPLAYED webhook consumes nothing additional');
select is(pg_temp.rewards('6c000000-0000-4000-8000-000000000002'), 1::bigint,
  'and queues no second reward');

-- ===========================================================================
-- FLOW 3: a failed Stripe session releases the hold
-- ===========================================================================
select pg_temp.claim('6b000000-0000-4000-8000-000000000003',
  '6a000000-0000-4000-8000-000000000003','r3@e.test',500);
select pg_temp.order_for('6c000000-0000-4000-8000-000000000003',
  '6a000000-0000-4000-8000-000000000003','PlayerTre','realvip-3m');

select ok(public.reserve_store_credit_for_order('6c000000-0000-4000-8000-000000000003',
  '6a000000-0000-4000-8000-000000000003', 500), 'reserved');
select is(pg_temp.gift_avail('6a000000-0000-4000-8000-000000000003'), 0::bigint, 'held');

select ok(public.release_store_credit_for_order('6c000000-0000-4000-8000-000000000003'),
  'a failed Stripe session releases the reservation');
select is(pg_temp.gift_avail('6a000000-0000-4000-8000-000000000003'), 500::bigint,
  'the $5.00 comes back to the SAME lot');
select is(pg_temp.ledger('6a000000-0000-4000-8000-000000000003'), 500::bigint,
  'and the ledger agrees');
select is((select state from public.store_credit_lot_allocations
  where order_id='6c000000-0000-4000-8000-000000000003'), 'released', 'the allocation is released');

-- Releasing twice cannot mint credit.
select ok(not public.release_store_credit_for_order('6c000000-0000-4000-8000-000000000003'),
  'a second release is a no-op');
select is(pg_temp.gift_avail('6a000000-0000-4000-8000-000000000003'), 500::bigint,
  'NO VALUE WAS CREATED by the double release');

-- ===========================================================================
-- FLOW 4: frozen value cannot fund a new order
-- ===========================================================================
select public.freeze_gift_card_credit('6b000000-0000-4000-8000-000000000003','dispute_opened');
select is(pg_temp.gift_avail('6a000000-0000-4000-8000-000000000003'), 0::bigint,
  'frozen gift-origin value is not available');

insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
  subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('6c000000-0000-4000-8000-000000000004','6a000000-0000-4000-8000-000000000003',
  'r@e.test','PlayerTre','stripe','pending',500,0,500,0,500,'USD');

select is(public.reserve_credit_lots('6a000000-0000-4000-8000-000000000003',
  '6c000000-0000-4000-8000-000000000004', 500), 0::bigint,
  'FROZEN VALUE CANNOT FUND A NEW ORDER');
select is((select count(*)::integer from public.store_credit_lot_allocations
  where order_id='6c000000-0000-4000-8000-000000000004'), 0, 'and no allocation was made');
select ok(exists(select 1 from public.store_credit_lots
  where gift_card_id='6b000000-0000-4000-8000-000000000003' and remaining_cents = 500),
  'the frozen value is still recorded, not deleted');

select * from finish();
rollback;
