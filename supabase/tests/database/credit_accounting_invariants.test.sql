-- The store-credit accounting equation, across every state transition.
--
-- THE EQUATION
-- ============
-- For any user, at any moment:
--
--   ledger_balance  =  sum(store_credit_ledger.delta_cents)
--   spendable       =  ledger_balance - sum(lots.frozen_cents)
--
-- and the following must always hold:
--
--   1. ledger_balance >= 0                      no improper negative balance
--   2. spendable      >= 0                      frozen cents are never spendable
--   3. lot_remaining + reserved + consumed
--        - restored  =  lot_original            no cent appears or vanishes
--   4. a release/restore never returns more than was taken
--
-- RF-05 broke (1) and (2): a cash-redemption freeze lived only on the lot, the
-- reservation consulted only the ledger, and the same cent was spent AND paid
-- out — ledger MINUS 2500.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id,email) values
 ('b1000000-0000-4000-8000-000000000001','buyer@e.test'),
 ('b2000000-0000-4000-8000-000000000002','holder@e.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like 'b_000000-0000-4000%' on conflict do nothing;
update public.products set active = true where slug in ('gift-card-25','realvip-3m');

insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,provider_payment_id,status,
 subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('b3000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000001','b@e.test','B','stripe','pi_acct','fulfilled',2500,0,2500,0,2500,'USD');
insert into public.gift_cards (id,original_balance_cents,balance_cents,currency,purchaser_user_id,purchaser_order_id,status,recipient_email,public_ref)
values ('b4000000-0000-4000-8000-000000000004',2500,2500,'USD','b1000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000003','active','holder@e.test','RFG-ACCT0001');
insert into public.gift_card_claim_credentials (gift_card_id,verifier,masked_suffix)
values ('b4000000-0000-4000-8000-000000000004','v-acct','WXYZ');
select public.claim_gift_card('v-acct','b2000000-0000-4000-8000-000000000002','holder@e.test');

create or replace function pg_temp.bal() returns bigint language sql as $$
  select coalesce(sum(delta_cents),0)::bigint from public.store_credit_ledger
  where user_id='b2000000-0000-4000-8000-000000000002' $$;
create or replace function pg_temp.frozen() returns bigint language sql as $$
  select coalesce(sum(frozen_cents),0)::bigint from public.store_credit_lots
  where user_id='b2000000-0000-4000-8000-000000000002' $$;
create or replace function pg_temp.spendable() returns bigint language sql as $$
  select pg_temp.bal() - pg_temp.frozen() $$;
-- remaining + reserved + (consumed - restored) must always equal original.
create or replace function pg_temp.lot_sum() returns bigint language sql as $$
  select (l.remaining_cents
          + coalesce((select sum(a.amount_cents) from public.store_credit_lot_allocations a
                      where a.lot_id=l.id and a.state='reserved'),0)
          + coalesce((select sum(a.amount_cents - a.restored_cents) from public.store_credit_lot_allocations a
                      where a.lot_id=l.id and a.state='consumed'),0))::bigint
  from public.store_credit_lots l where l.user_id='b2000000-0000-4000-8000-000000000002' $$;

-- ===========================================================================
-- Baseline
-- ===========================================================================
select is(pg_temp.bal(), 2500::bigint, 'BASELINE: ledger holds $25');
select is(pg_temp.spendable(), 2500::bigint, 'BASELINE: all of it spendable');
select is(pg_temp.lot_sum(), 2500::bigint, 'BASELINE: lot accounts for exactly $25');

-- ===========================================================================
-- RESERVE -> CONSUME
-- ===========================================================================
insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
 subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('b5000000-0000-4000-8000-000000000005','b2000000-0000-4000-8000-000000000002','h@e.test','H','stripe','pending',1000,0,1000,0,1000,'USD');
insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
select 'b5000000-0000-4000-8000-000000000005', id, '{"slug":"realvip-3m"}'::jsonb,1,1000,1000 from public.products where slug='realvip-3m';

select ok(public.reserve_store_credit_for_order('b5000000-0000-4000-8000-000000000005','b2000000-0000-4000-8000-000000000002',1000),
  'RESERVE $10 succeeds');
select is(pg_temp.bal(), 1500::bigint, 'reserve debits the ledger');
select is(pg_temp.lot_sum(), 2500::bigint, 'RESERVE conserves the lot total');

select ok(public.complete_store_credit_only_order('b5000000-0000-4000-8000-000000000005','b2000000-0000-4000-8000-000000000002'),
  'CONSUME succeeds');
select is(pg_temp.bal(), 1500::bigint, 'consume does not move the balance again');
select is(pg_temp.lot_sum(), 2500::bigint, 'CONSUME conserves the lot total');

-- ===========================================================================
-- RESERVE -> RELEASE (a failed checkout)
-- ===========================================================================
insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
 subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('b6000000-0000-4000-8000-000000000006','b2000000-0000-4000-8000-000000000002','h@e.test','H','stripe','pending',500,0,500,0,500,'USD');
insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
select 'b6000000-0000-4000-8000-000000000006', id, '{"slug":"realvip-3m"}'::jsonb,1,500,500 from public.products where slug='realvip-3m';

select ok(public.reserve_store_credit_for_order('b6000000-0000-4000-8000-000000000006','b2000000-0000-4000-8000-000000000002',500),
  'RESERVE $5 for an order that will fail');
select is(pg_temp.bal(), 1000::bigint, 'balance drops to $10');
select public.release_store_credit_for_order('b6000000-0000-4000-8000-000000000006');
select is(pg_temp.bal(), 1500::bigint, 'RELEASE returns exactly $5 — no more, no less');

-- Releasing twice must not credit twice.
select public.release_store_credit_for_order('b6000000-0000-4000-8000-000000000006');
select is(pg_temp.bal(), 1500::bigint, 'A SECOND RELEASE RESTORES NOTHING FURTHER');
select is(pg_temp.lot_sum(), 2500::bigint, 'RELEASE conserves the lot total');

-- ===========================================================================
-- FREEZE: the RF-05 invariant
-- ===========================================================================
select is((select state from public.request_cash_redemption('b2000000-0000-4000-8000-000000000002')),
  'requested', 'a cash-redemption review is opened on the remainder');
select ok(pg_temp.frozen() > 0, 'value is frozen on the lot');
select ok(pg_temp.spendable() >= 0, 'SPENDABLE NEVER GOES NEGATIVE WHILE FROZEN');

insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
 subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('b7000000-0000-4000-8000-000000000007','b2000000-0000-4000-8000-000000000002','h@e.test','H','stripe','pending',1500,0,1500,0,1500,'USD');
insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
select 'b7000000-0000-4000-8000-000000000007', id, '{"slug":"realvip-3m"}'::jsonb,1,1500,1500 from public.products where slug='realvip-3m';

select is(public.reserve_store_credit_for_order('b7000000-0000-4000-8000-000000000007','b2000000-0000-4000-8000-000000000002',1500),
  false, 'FROZEN CENTS CANNOT BE RESERVED — the RF-05 invariant');

-- ===========================================================================
-- Cash redemption REJECTED -> the freeze is released, not lost
-- ===========================================================================
select public.resolve_cash_redemption(
  (select id from public.cash_redemption_requests where claimant_user_id='b2000000-0000-4000-8000-000000000002'
   and state='requested'), 'rejected', 'not required');
select is(pg_temp.frozen(), 0::bigint, 'REJECT releases the freeze');
select is(pg_temp.bal(), 1500::bigint, 'and the balance is unchanged — no cent vanished');

select * from finish();
rollback;
