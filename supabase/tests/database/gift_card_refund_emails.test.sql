-- Refund and dispute emails are enqueued ATOMICALLY with the state change, once.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id,email) values
  ('9a000000-0000-4000-8000-000000000001','buyer@e.test'),
  ('9a000000-0000-4000-8000-000000000002','recip@e.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like '9a000000%' on conflict do nothing;

insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,provider_payment_id,status,
  subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('9c000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001','buyer@e.test','B','stripe','pi_mail','fulfilled',
  2500,0,2500,0,2500,'USD');
insert into public.gift_cards (id,original_balance_cents,balance_cents,currency,purchaser_user_id,purchaser_order_id,status,recipient_email,public_ref)
values ('9b000000-0000-4000-8000-000000000001',2500,2500,'USD','9a000000-0000-4000-8000-000000000001',
  '9c000000-0000-4000-8000-000000000001','active','recip@e.test','RFG-MAIL0001');
insert into public.gift_card_claim_credentials (gift_card_id,verifier,masked_suffix)
values ('9b000000-0000-4000-8000-000000000001','v-mail','WXYZ');
select public.claim_gift_card('v-mail','9a000000-0000-4000-8000-000000000002','recip@e.test');

-- ===========================================================================
-- Dispute opened -> the recipient is told about the hold, ONCE
-- ===========================================================================
select public.record_gift_card_dispute('9b000000-0000-4000-8000-000000000001','evt_du_1',2500);

select is((select recipient from public.email_deliveries
  where template='gift_card_frozen_recipient'), 'recip@e.test', 'the RECIPIENT is told about the hold');
select is((select (params->>'amount_cents')::bigint from public.email_deliveries
  where template='gift_card_frozen_recipient'), 2500::bigint, 'for the frozen amount');
select is((select order_id from public.email_deliveries
  where template='gift_card_frozen_recipient'), null,
  'and the row is NOT linked to the purchaser order');
select is((select count(*)::integer from public.email_deliveries
  where template like 'gift_card_%' and recipient='buyer@e.test'), 0,
  'THE PURCHASER IS NOT EMAILED about a dispute they filed');

select public.record_gift_card_dispute('9b000000-0000-4000-8000-000000000001','evt_du_2',2500);
select is((select count(*)::integer from public.email_deliveries
  where template='gift_card_frozen_recipient'), 1, 'a REPLAYED dispute event sends nothing more');

-- ===========================================================================
-- Dispute won -> restored. Lost -> silence.
-- ===========================================================================
select public.resolve_gift_card_dispute('9b000000-0000-4000-8000-000000000001','evt_dc_1','won');
select is((select (params->>'amount_cents')::bigint from public.email_deliveries
  where template='gift_card_restored_recipient'), 2500::bigint, 'a WON dispute releases and says so');
select is((select (params->>'balance_cents')::bigint from public.email_deliveries
  where template='gift_card_restored_recipient'), 2500::bigint, 'with their real balance');

update public.gift_cards set dispute_closed_at = null, dispute_status = 'open' where id='9b000000-0000-4000-8000-000000000001';
update public.store_credit_lots set frozen_cents = remaining_cents where gift_card_id='9b000000-0000-4000-8000-000000000001';
delete from public.payment_reviews where provider_event_id='evt_dc_2';
select public.resolve_gift_card_dispute('9b000000-0000-4000-8000-000000000001','evt_dc_2','lost');
select is((select count(*)::integer from public.email_deliveries
  where template='gift_card_restored_recipient'), 1,
  'A LOST DISPUTE EMAILS NOBODY — the value stays frozen and a human owns it');

-- ===========================================================================
-- Review -> the purchaser hears, and learns nothing about the recipient
-- ===========================================================================
update public.gift_cards set dispute_status=null, disputed_at=null, dispute_closed_at=null,
  frozen_at=null, frozen_reason=null where id='9b000000-0000-4000-8000-000000000001';
update public.store_credit_lots set frozen_cents = 0 where gift_card_id='9b000000-0000-4000-8000-000000000001';

-- A REAL spend, through the real allocation path: consumption is derived from
-- the allocation rows, so faking a column here would test nothing.
update public.products set active = true where slug = 'realvip-3m';
insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
  subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('9c000000-0000-4000-8000-000000000002','9a000000-0000-4000-8000-000000000002','recip@e.test','R','stripe','pending',
  1299,0,1299,0,1299,'USD');
insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
select '9c000000-0000-4000-8000-000000000002', id, '{"slug":"realvip-3m"}'::jsonb, 1, 1299, 1299
from public.products where slug='realvip-3m';
select public.reserve_store_credit_for_order('9c000000-0000-4000-8000-000000000002','9a000000-0000-4000-8000-000000000002',1299);
select public.complete_store_credit_only_order('9c000000-0000-4000-8000-000000000002','9a000000-0000-4000-8000-000000000002');

select public.begin_gift_card_refund('9b000000-0000-4000-8000-000000000001');

select is((select recipient from public.email_deliveries
  where template='gift_card_refund_review'), 'buyer@e.test', 'the PURCHASER hears about the review');
select ok((select params::text not like '%1201%' and params::text not like '%1299%'
  and params::text not like '%spent%' and params::text not like '%reason%'
  from public.email_deliveries where template='gift_card_refund_review'),
  'AND THE PARAMS CARRY NO RECIPIENT SPEND STATE');
select is((select count(*)::integer from public.email_deliveries
  where template='gift_card_refunded_recipient'), 0, 'the recipient is not told a review opened');

-- ===========================================================================
-- Completed -> both sides, exactly once each
-- ===========================================================================
update public.gift_card_refunds set state='eligible_claimed_unused', eligible_external_cents=2500,
  review_reason=null where gift_card_id='9b000000-0000-4000-8000-000000000001';

select public.complete_gift_card_refund(
  (select id from public.gift_card_refunds where gift_card_id='9b000000-0000-4000-8000-000000000001'),
  're_mail', 2500);

select is((select (params->>'amount_cents')::bigint from public.email_deliveries
  where template='gift_card_refunded'), 2500::bigint, 'the purchaser is told the refund completed');
select is((select recipient from public.email_deliveries
  where template='gift_card_refunded_recipient'), 'recip@e.test',
  'and the recipient is told the value left their balance');
select is((select (params->>'amount_cents')::bigint from public.email_deliveries
  where template='gift_card_refunded_recipient'), 1201::bigint,
  'quoting WHAT LEFT THEIR BALANCE, not what the purchaser was refunded');
select is((select (params->>'balance_cents')::bigint from public.email_deliveries
  where template='gift_card_refunded_recipient'), 0::bigint,
  'showing the balance AFTER the reversal, not before');

select public.complete_gift_card_refund(
  (select id from public.gift_card_refunds where gift_card_id='9b000000-0000-4000-8000-000000000001'),
  're_mail', 2500);
select is((select count(*)::integer from public.email_deliveries
  where template in ('gift_card_refunded','gift_card_refunded_recipient')), 2,
  'REPLAYING THE COMPLETION SENDS NOTHING TWICE');

select * from finish();
rollback;
