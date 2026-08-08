-- Frozen gift-origin credit is not spendable (RF-05).
--
-- The ledger holds the balance; the lot holds the FREEZE. Before the fix,
-- `reserve_store_credit_for_order` consulted only the ledger, so value held for
-- a cash-redemption review still looked spendable — the same $25 could be
-- reserved for a purchase and later paid out in cash, leaving the ledger at
-- MINUS 2500. Reproduced with two genuinely concurrent connections.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id,email) values
 ('c1000000-0000-4000-8000-000000000001','buyer@e.test'),
 ('c2000000-0000-4000-8000-000000000002','holder@e.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like 'c%0000-4000%' on conflict do nothing;
update public.products set active = true where slug in ('gift-card-25','realvip-3m');

insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,provider_payment_id,status,
 subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('c3000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001','b@e.test','B','stripe','pi_frz','fulfilled',2500,0,2500,0,2500,'USD');
insert into public.gift_cards (id,original_balance_cents,balance_cents,currency,purchaser_user_id,purchaser_order_id,status,recipient_email,public_ref)
values ('c4000000-0000-4000-8000-000000000004',2500,2500,'USD','c1000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000003','active','holder@e.test','RFG-FROZEN01');
insert into public.gift_card_claim_credentials (gift_card_id,verifier,masked_suffix)
values ('c4000000-0000-4000-8000-000000000004','v-frozen','WXYZ');
select public.claim_gift_card('v-frozen','c2000000-0000-4000-8000-000000000002','holder@e.test');

insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
 subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('c5000000-0000-4000-8000-000000000005','c2000000-0000-4000-8000-000000000002','h@e.test','H','stripe','pending',2500,0,2500,0,2500,'USD');
insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
select 'c5000000-0000-4000-8000-000000000005', id, '{"slug":"realvip-3m"}'::jsonb,1,2500,2500
from public.products where slug='realvip-3m';

select is((select public.gift_origin_available('c2000000-0000-4000-8000-000000000002')), 2500::bigint,
  'the holder starts with $25 of gift-origin credit');

-- ===========================================================================
-- Freeze first, then attempt to spend it
-- ===========================================================================
select is((select state from public.request_cash_redemption('c2000000-0000-4000-8000-000000000002')),
  'requested', 'a cash-redemption review is opened');
select is((select frozen_cents from public.store_credit_lots where user_id='c2000000-0000-4000-8000-000000000002'),
  2500::bigint, 'and the value is frozen on the lot');

select is(
  (select public.reserve_store_credit_for_order('c5000000-0000-4000-8000-000000000005','c2000000-0000-4000-8000-000000000002',2500)),
  false,
  'FROZEN CREDIT CANNOT BE RESERVED FOR A PURCHASE'
);
select is((select coalesce(sum(delta_cents),0)::bigint from public.store_credit_ledger
  where user_id='c2000000-0000-4000-8000-000000000002'), 2500::bigint,
  'the ledger is untouched by the refused reservation');

-- ===========================================================================
-- Completing the payout cannot drive the ledger negative
-- ===========================================================================
select public.resolve_cash_redemption(
  (select id from public.cash_redemption_requests where claimant_user_id='c2000000-0000-4000-8000-000000000002'),
  'manual_payout_required', 'approved');
select public.resolve_cash_redemption(
  (select id from public.cash_redemption_requests where claimant_user_id='c2000000-0000-4000-8000-000000000002'),
  'completed', 'paid', 2500);

select is((select coalesce(sum(delta_cents),0)::bigint from public.store_credit_ledger
  where user_id='c2000000-0000-4000-8000-000000000002'), 0::bigint,
  'after the cash payout the balance is exactly zero');
select ok((select coalesce(sum(delta_cents),0)::bigint from public.store_credit_ledger
  where user_id='c2000000-0000-4000-8000-000000000002') >= 0,
  'THE LEDGER IS NEVER NEGATIVE — the same cent was not spent and paid out');

select * from finish();
rollback;
