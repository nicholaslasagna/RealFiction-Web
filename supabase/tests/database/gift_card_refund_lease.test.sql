-- Two Workers racing the same refund, and lease recovery after a crash.
--
-- Proven for refunds specifically, not inherited from the payment reconciler:
-- the tables, the states, and the finalisation are different, and a lease bug
-- here would either double-refund or strand frozen value forever.

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id,email) values ('8a000000-0000-4000-8000-000000000001','b@e.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like '8a000000%' on conflict do nothing;

insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,provider_payment_id,status,
  subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('8c000000-0000-4000-8000-000000000001','8a000000-0000-4000-8000-000000000001','b@e.test','B','stripe','pi_lease','fulfilled',
  2500,0,2500,0,2500,'USD');
insert into public.gift_cards (id,original_balance_cents,balance_cents,currency,purchaser_user_id,purchaser_order_id,status,public_ref)
values ('8b000000-0000-4000-8000-000000000001',2500,2500,'USD','8a000000-0000-4000-8000-000000000001',
  '8c000000-0000-4000-8000-000000000001','active','RFG-LEASE001');
insert into public.gift_card_claim_credentials (gift_card_id,verifier,masked_suffix)
values ('8b000000-0000-4000-8000-000000000001','v-lease','WXYZ');

-- A refund whose provider result is unknown: the state reconciliation recovers.
select public.begin_gift_card_refund('8b000000-0000-4000-8000-000000000001');
select public.mark_gift_card_refund_pending(
  (select id from public.gift_card_refunds where gift_card_id='8b000000-0000-4000-8000-000000000001'));
update public.gift_card_refunds set provider_requested_at = now() - interval '5 minutes'
where gift_card_id='8b000000-0000-4000-8000-000000000001';

select is((select state from public.gift_card_refunds
  where gift_card_id='8b000000-0000-4000-8000-000000000001'), 'provider_refund_pending',
  'the refund is awaiting an authoritative provider result');

-- ===========================================================================
-- Two workers
-- ===========================================================================
select is((select count(*)::integer from public.claim_pending_gift_card_refunds('worker-a',10,120,60)), 1,
  'worker A claims it');
select is((select count(*)::integer from public.claim_pending_gift_card_refunds('worker-b',10,120,60)), 0,
  'WORKER B IS REFUSED while the lease is live');
select is((select reconciliation_worker from public.gift_card_refunds
  where gift_card_id='8b000000-0000-4000-8000-000000000001'), 'worker-a', 'the lease names its holder');
select is((select attempts from public.gift_card_refunds
  where gift_card_id='8b000000-0000-4000-8000-000000000001'), 2,
  'and the attempt counter moved exactly once for the one successful claim');

-- A claim alone changes nothing about the money.
select is((select state from public.gift_card_refunds
  where gift_card_id='8b000000-0000-4000-8000-000000000001'), 'provider_refund_pending',
  'claiming does not finalise');
select is((select status::text from public.gift_cards where id='8b000000-0000-4000-8000-000000000001'),
  'active', 'and does not void the card');

-- ===========================================================================
-- Crashed worker: the lease expires, nothing was released by crashing
-- ===========================================================================
update public.gift_card_refunds set reconciliation_lease_until = now() - interval '1 second'
where gift_card_id='8b000000-0000-4000-8000-000000000001';

select is((select count(*)::integer from public.claim_pending_gift_card_refunds('worker-b',10,120,60)), 1,
  'AFTER THE LEASE EXPIRES the refund is claimable again');
select is((select state from public.gift_card_refunds
  where gift_card_id='8b000000-0000-4000-8000-000000000001'), 'provider_refund_pending',
  'A CRASHED WORKER FINALISED NOTHING');

-- ===========================================================================
-- One finalisation, whichever worker gets there
-- ===========================================================================
select is((select outcome from public.complete_gift_card_refund(
  (select id from public.gift_card_refunds where gift_card_id='8b000000-0000-4000-8000-000000000001'),
  're_lease', 2500)), 'completed', 'the winner finalises');
select is((select outcome from public.complete_gift_card_refund(
  (select id from public.gift_card_refunds where gift_card_id='8b000000-0000-4000-8000-000000000001'),
  're_lease', 2500)), 'already_completed', 'THE LOSER FINALISES NOTHING');
select is((select count(*)::integer from public.order_refunds
  where order_id='8c000000-0000-4000-8000-000000000001'), 1, 'exactly ONE external reversal recorded');

select * from finish();
rollback;
