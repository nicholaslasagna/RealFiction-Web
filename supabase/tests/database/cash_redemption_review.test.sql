-- Cash-redemption REVIEW: eligibility, provenance, and the two races.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id,email) values
  ('5a000000-0000-4000-8000-000000000001','buyer@e.test'),
  ('5a000000-0000-4000-8000-000000000002','claimant@e.test'),
  ('5a000000-0000-4000-8000-000000000003','promo@e.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like '5a000000%' on conflict do nothing;
update public.products set active = true where slug in ('gift-card-25','realvip-3m');

insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,provider_payment_id,status,
  subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('5c000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000001','buyer@e.test','B','stripe','pi_cash','fulfilled',
  2500,0,2500,0,2500,'USD');
insert into public.gift_cards (id,original_balance_cents,balance_cents,currency,purchaser_user_id,purchaser_order_id,status,recipient_email,public_ref)
values ('5b000000-0000-4000-8000-000000000001',2500,2500,'USD','5a000000-0000-4000-8000-000000000001',
  '5c000000-0000-4000-8000-000000000001','active','claimant@e.test','RFG-CASH0001');
insert into public.gift_card_claim_credentials (gift_card_id,verifier,masked_suffix)
values ('5b000000-0000-4000-8000-000000000001','v-cash','WXYZ');
select public.claim_gift_card('v-cash','5a000000-0000-4000-8000-000000000002','claimant@e.test');

-- ===========================================================================
-- Ineligible sources
-- ===========================================================================
select is((select state from public.request_cash_redemption('5a000000-0000-4000-8000-000000000003')),
  'ineligible', 'an account with NO gift credit is ineligible');

-- Promotional credit: real balance, real lot, wrong source.
insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
values ('5a000000-0000-4000-8000-000000000003', 5000, 'manual_grant', 'promo', 'promo:1', 'Promo');
insert into public.store_credit_lots (user_id, source, original_cents, remaining_cents, currency)
values ('5a000000-0000-4000-8000-000000000003', 'promotional', 5000, 5000, 'USD');

select is((select state from public.request_cash_redemption('5a000000-0000-4000-8000-000000000003')),
  'ineligible', 'PROMOTIONAL CREDIT CANNOT BE REDEEMED FOR CASH');
select is((select reason from public.request_cash_redemption('5a000000-0000-4000-8000-000000000003')),
  'no_eligible_gift_credit', 'and it is not even seen as a candidate');

-- Ordinary unlotted store credit: a balance with no lot at all.
insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
values ('5a000000-0000-4000-8000-000000000001', 9900, 'manual_grant', 'plain', 'plain:1', 'Plain credit');
select is((select state from public.request_cash_redemption('5a000000-0000-4000-8000-000000000001')),
  'ineligible', 'ORDINARY UNLOTTED STORE CREDIT CANNOT BE REDEEMED');
select is((select balance_cents from public.get_store_credit_balance('5a000000-0000-4000-8000-000000000001')),
  9900::bigint, 'even though the account really does hold a balance');

-- ===========================================================================
-- The eligible path
-- ===========================================================================
select is((select state from public.request_cash_redemption('5a000000-0000-4000-8000-000000000002')),
  'requested', 'AN ELIGIBLE GIFT-ORIGIN REMAINDER PRODUCES A REQUEST');

select is((select requested_cents from public.cash_redemption_requests
  where claimant_user_id='5a000000-0000-4000-8000-000000000002'), 2500::bigint,
  'for the SERVER-COMPUTED amount');
select is((select frozen_cents from public.store_credit_lots
  where user_id='5a000000-0000-4000-8000-000000000002'), 2500::bigint,
  'AND THE VALUE IS FROZEN');
select is((select public.gift_origin_available('5a000000-0000-4000-8000-000000000002')), 0::bigint,
  'so none of it is spendable any more');
select is((select count(*)::integer from public.payment_reviews where event_type='cash_redemption_request'), 1,
  'exactly ONE review was created');
select is((select state from public.cash_redemption_requests
  where claimant_user_id='5a000000-0000-4000-8000-000000000002'), 'requested',
  'NO AUTOMATIC PAYOUT — the request sits at requested');
select is((select paid_out_cents from public.cash_redemption_requests
  where claimant_user_id='5a000000-0000-4000-8000-000000000002'), 0::bigint,
  'and nothing has been paid');

-- ===========================================================================
-- Provenance
-- ===========================================================================
select is((select (provenance->>'purchaser_user_id') from public.cash_redemption_requests
  where claimant_user_id='5a000000-0000-4000-8000-000000000002'), '5a000000-0000-4000-8000-000000000001',
  'the review identifies the ORIGINAL PURCHASER');
select is((select (provenance->>'gift_card_id') from public.cash_redemption_requests
  where claimant_user_id='5a000000-0000-4000-8000-000000000002'), '5b000000-0000-4000-8000-000000000001',
  'and the originating gift card');
select ok((select provenance ?& array['original_cents','remaining_cents','frozen_cents','reserved_cents',
  'consumed_cents','prior_redeemed_cents','claimant_user_id']
  from public.cash_redemption_requests where claimant_user_id='5a000000-0000-4000-8000-000000000002'),
  'and every value the reviewer needs');

-- ===========================================================================
-- Idempotence
-- ===========================================================================
select is((select reason from public.request_cash_redemption('5a000000-0000-4000-8000-000000000002')),
  'already_open', 'A DUPLICATE REQUEST IS IDEMPOTENT');
select is((select count(*)::integer from public.cash_redemption_requests
  where claimant_user_id='5a000000-0000-4000-8000-000000000002'), 1, 'one row');
select is((select frozen_cents from public.store_credit_lots
  where user_id='5a000000-0000-4000-8000-000000000002'), 2500::bigint,
  'AND THE VALUE IS NOT FROZEN TWICE');

-- ===========================================================================
-- RACE 1: redemption freezes first -> checkout cannot reserve it
-- ===========================================================================
insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
  subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('5c000000-0000-4000-8000-000000000002','5a000000-0000-4000-8000-000000000002','claimant@e.test','C','stripe','pending',
  1299,0,1299,0,1299,'USD');
insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
select '5c000000-0000-4000-8000-000000000002', id, '{"slug":"realvip-3m"}'::jsonb,1,1299,1299
from public.products where slug='realvip-3m';

select is((select public.reserve_credit_lots('5a000000-0000-4000-8000-000000000002',
  '5c000000-0000-4000-8000-000000000002', 1299)), 0::bigint,
  'REDEMPTION WON: checkout allocates ZERO from the frozen lot');
select is((select count(*)::integer from public.store_credit_lot_allocations
  where order_id='5c000000-0000-4000-8000-000000000002'), 0,
  'and no allocation row exists to be consumed later');
select is((select remaining_cents from public.store_credit_lots
  where user_id='5a000000-0000-4000-8000-000000000002'), 2500::bigint,
  'the lot is untouched — THE SAME CENT WAS NOT USED TWICE');

-- ===========================================================================
-- RACE 2: checkout reserves first -> redemption re-evaluates downward
-- ===========================================================================
select public.resolve_cash_redemption(
  (select id from public.cash_redemption_requests where claimant_user_id='5a000000-0000-4000-8000-000000000002'),
  'rejected', 'race test');
select is((select frozen_cents from public.store_credit_lots
  where user_id='5a000000-0000-4000-8000-000000000002'), 0::bigint,
  'a rejected request RELEASES the freeze');

select is((select public.reserve_credit_lots('5a000000-0000-4000-8000-000000000002',
  '5c000000-0000-4000-8000-000000000002', 1299)), 1299::bigint,
  'now checkout wins the race and reserves $12.99');

select is((select requested_cents from public.cash_redemption_requests
  where claimant_user_id='5a000000-0000-4000-8000-000000000002'
    and state='requested'), null,
  'no live request exists yet');
select public.request_cash_redemption('5a000000-0000-4000-8000-000000000002');
select is((select requested_cents from public.cash_redemption_requests
  where claimant_user_id='5a000000-0000-4000-8000-000000000002' and state='requested'), 1201::bigint,
  'RESERVATION WON: redemption RE-EVALUATES to only what is left');
select is((select (remaining_cents + (select coalesce(sum(amount_cents),0)
    from public.store_credit_lot_allocations a where a.lot_id = l.id and a.state='reserved'))::bigint
  from public.store_credit_lots l where l.user_id='5a000000-0000-4000-8000-000000000002'), 2500::bigint,
  'reserved + remaining still equals the original $25 — nothing was created or lost');

-- ===========================================================================
-- Disputed value can never be redeemed
-- ===========================================================================
select public.resolve_cash_redemption(
  (select id from public.cash_redemption_requests where claimant_user_id='5a000000-0000-4000-8000-000000000002'
   and state='requested'), 'rejected', 'clear for dispute test');
update public.gift_cards set disputed_at = now(), dispute_status='open'
where id='5b000000-0000-4000-8000-000000000001';

select is((select reason from public.request_cash_redemption('5a000000-0000-4000-8000-000000000002')),
  'disputed', 'DISPUTED VALUE CANNOT BE REDEEMED FOR CASH');

select * from finish();
rollback;
