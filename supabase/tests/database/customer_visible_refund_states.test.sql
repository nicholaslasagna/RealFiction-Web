-- What the readers are allowed to return.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id,email) values
  ('7a000000-0000-4000-8000-000000000001','buyer@e.test'),
  ('7a000000-0000-4000-8000-000000000002','recip@e.test'),
  ('7a000000-0000-4000-8000-000000000003','other@e.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like '7a000000%' on conflict do nothing;

insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,provider_payment_id,status,
  subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('7c000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000001','buyer@e.test','B','stripe','pi_vis','fulfilled',
  2500,0,2500,0,2500,'USD');
insert into public.gift_cards (id,original_balance_cents,balance_cents,currency,purchaser_user_id,purchaser_order_id,status,recipient_email,public_ref)
values ('7b000000-0000-4000-8000-000000000001',2500,2500,'USD','7a000000-0000-4000-8000-000000000001',
  '7c000000-0000-4000-8000-000000000001','active','recip@e.test','RFG-VIS00001');
insert into public.gift_card_claim_credentials (gift_card_id,verifier,masked_suffix)
values ('7b000000-0000-4000-8000-000000000001','v-vis','WXYZ');
select public.claim_gift_card('v-vis','7a000000-0000-4000-8000-000000000002','recip@e.test');

-- ===========================================================================
-- Nothing to report
-- ===========================================================================
select is((select count(*)::integer from public.purchaser_gift_card_states('7a000000-0000-4000-8000-000000000001')), 0,
  'a card with no refund and no dispute reports NOTHING');

-- ===========================================================================
-- Refund states
-- ===========================================================================
select public.begin_gift_card_refund('7b000000-0000-4000-8000-000000000001');
select is((select state from public.purchaser_gift_card_states('7a000000-0000-4000-8000-000000000001')),
  'refund_processing', 'a started refund reads as processing');

select public.mark_gift_card_refund_pending(
  (select id from public.gift_card_refunds where gift_card_id='7b000000-0000-4000-8000-000000000001'));
select is((select state from public.purchaser_gift_card_states('7a000000-0000-4000-8000-000000000001')),
  'refund_processing', 'and STILL processing while the provider call is in flight');

select public.complete_gift_card_refund(
  (select id from public.gift_card_refunds where gift_card_id='7b000000-0000-4000-8000-000000000001'),
  're_vis', 2500);
select is((select state from public.purchaser_gift_card_states('7a000000-0000-4000-8000-000000000001')),
  'refunded', 'a completed refund reads as refunded');

-- ===========================================================================
-- Isolation
-- ===========================================================================
select is((select count(*)::integer from public.purchaser_gift_card_states('7a000000-0000-4000-8000-000000000002')), 0,
  'THE RECIPIENT SEES NOTHING through the purchaser reader');
select is((select count(*)::integer from public.purchaser_gift_card_states('7a000000-0000-4000-8000-000000000003')), 0,
  'and neither does an unrelated account');

-- ===========================================================================
-- A rejected refund is silent; a dispute outranks everything
-- ===========================================================================
update public.gift_card_refunds set state='rejected', review_reason='already_fully_refunded'
where gift_card_id='7b000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.purchaser_gift_card_states('7a000000-0000-4000-8000-000000000001')), 0,
  'a REJECTED refund leaves no permanent badge');

update public.gift_cards set disputed_at = now(), dispute_status='open', dispute_closed_at=null
where id='7b000000-0000-4000-8000-000000000001';
select is((select state from public.purchaser_gift_card_states('7a000000-0000-4000-8000-000000000001')),
  'disputed', 'an OPEN dispute outranks any refund state');

update public.gift_cards set dispute_closed_at = now(), dispute_status='won'
where id='7b000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.purchaser_gift_card_states('7a000000-0000-4000-8000-000000000001')), 0,
  'and a closed dispute stops being shown');

-- ===========================================================================
-- The recipient's own view
-- ===========================================================================
-- The refund above drained this lot; restore value so a freeze has something
-- to hold, which is the state a live chargeback produces.
update public.store_credit_lots set remaining_cents = 2500, frozen_cents = 2500
where gift_card_id='7b000000-0000-4000-8000-000000000001';
select is((select hold_cents from public.recipient_credit_hold('7a000000-0000-4000-8000-000000000002')),
  2500::bigint, 'the recipient sees the amount on hold');
select is((select hold_cents from public.recipient_credit_hold('7a000000-0000-4000-8000-000000000001')),
  0::bigint, 'THE PURCHASER SEES NO HOLD — it is not their balance');

select * from finish();
rollback;
