-- Gift-card refunds and disputes: every acceptance path.
--
-- The defect these close: refunding a CLAIMED card through the ordinary
-- `revoke_order` path returns the money and leaves the stored value spendable.
-- Stored value is not an entitlement, and what is safe depends on what happened
-- to the VALUE, not to the order.

begin;
create extension if not exists pgtap with schema extensions;
select plan(68);

insert into auth.users (id,email) values
  ('7a000000-0000-4000-8000-000000000001','buyer@e.test'),
  ('7a000000-0000-4000-8000-000000000002','rec1@e.test'),
  ('7a000000-0000-4000-8000-000000000003','rec2@e.test'),
  ('7a000000-0000-4000-8000-000000000004','rec3@e.test'),
  ('7a000000-0000-4000-8000-000000000005','rec4@e.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like '7a000000%' on conflict do nothing;
insert into public.minecraft_account_links (user_id,minecraft_username,minecraft_uuid,verification_code,status,verified_at)
select id, 'P'||right(id::text,4), gen_random_uuid(), 'C'||right(id::text,4), 'verified', now()
from auth.users where id::text like '7a000000%' on conflict do nothing;

/** A paid, issued gift card with a purchase order that collected p_cents. */
create or replace function pg_temp.issue(p_card uuid, p_order uuid, p_cents integer, p_email text, p_verifier text)
returns void language plpgsql as $$
declare v_pid uuid;
begin
  select id into v_pid from public.products where category='gift_cards' and price_cents=p_cents limit 1;
  insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
    subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
  values (p_order,'7a000000-0000-4000-8000-000000000001','buyer@e.test','B','stripe','fulfilled',
    p_cents,0,p_cents,0,p_cents,'USD');
  insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
  values (p_order,v_pid,jsonb_build_object('slug','gift-card'),1,p_cents,p_cents);
  insert into public.gift_cards (id,original_balance_cents,balance_cents,currency,purchaser_user_id,
    purchaser_order_id,status,recipient_email,public_ref)
  values (p_card,p_cents,p_cents,'USD','7a000000-0000-4000-8000-000000000001',p_order,'active',p_email,
    'RFG-'||upper(right(replace(p_card::text,'-',''),10)));
  insert into public.gift_card_claim_credentials (gift_card_id,verifier,masked_suffix)
  values (p_card,p_verifier,'WXYZ');
end; $$;

create or replace function pg_temp.avail(p_user uuid) returns bigint language sql as $$
  select public.gift_origin_available(p_user)
$$;
create or replace function pg_temp.ledger(p_user uuid) returns bigint language sql as $$
  select coalesce(sum(delta_cents),0) from public.store_credit_ledger where user_id=p_user
$$;
create or replace function pg_temp.credstate(p_card uuid) returns text language sql as $$
  select state from public.gift_card_claim_credentials where gift_card_id=p_card order by issued_at desc limit 1
$$;

-- ===========================================================================
-- A. UNCLAIMED — void it, refund the money
-- ===========================================================================
select pg_temp.issue('7b000000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000001',
  2500,'rec1@e.test','v-unclaimed');

select is((select state from public.begin_gift_card_refund('7b000000-0000-4000-8000-000000000001')),
  'eligible_unclaimed', 'an unclaimed card is refundable');
select is((select eligible_external_cents from public.gift_card_refunds
  where gift_card_id='7b000000-0000-4000-8000-000000000001'), 2500::bigint,
  'for exactly the $25.00 that was actually collected');
select is(pg_temp.credstate('7b000000-0000-4000-8000-000000000001'), 'invalidated',
  'THE CREDENTIAL IS INVALIDATED the moment the refund starts');

-- A claim attempt now gets nothing.
select is((select outcome from public.claim_gift_card('v-unclaimed',
  '7a000000-0000-4000-8000-000000000002','rec1@e.test')), 'invalid',
  'and the card can no longer be claimed');
select is(pg_temp.avail('7a000000-0000-4000-8000-000000000002'), 0::bigint, 'no credit was granted');

select ok(public.mark_gift_card_refund_pending(
  (select id from public.gift_card_refunds where gift_card_id='7b000000-0000-4000-8000-000000000001')),
  'the provider call is marked in flight');

select is((select outcome from public.complete_gift_card_refund(
  (select id from public.gift_card_refunds where gift_card_id='7b000000-0000-4000-8000-000000000001'),
  're_unclaimed', 2500)), 'completed', 'the confirmed refund completes');
select is((select reversed_cents from public.complete_gift_card_refund(
  (select id from public.gift_card_refunds where gift_card_id='7b000000-0000-4000-8000-000000000001'),
  're_unclaimed', 2500)), 0::bigint, 'reversing NOTHING internally — nobody was ever credited');
select is((select status::text from public.gift_cards where id='7b000000-0000-4000-8000-000000000001'),
  'void', 'the card is void');
select is((select external_refund_cents from public.order_refunds
  where order_id='7c000000-0000-4000-8000-000000000001'), 2500::bigint,
  'and exactly 2500 cents is recorded against the purchase order');

-- Replay.
select is((select outcome from public.complete_gift_card_refund(
  (select id from public.gift_card_refunds where gift_card_id='7b000000-0000-4000-8000-000000000001'),
  're_unclaimed', 2500)), 'already_completed', 'A REPLAY REFUNDS NOTHING TWICE');
select is((select count(*)::integer from public.order_refunds
  where order_id='7c000000-0000-4000-8000-000000000001'), 1, 'and records no second reversal');

-- ===========================================================================
-- B. CLAIMED BUT UNUSED — reverse the exact credit
-- ===========================================================================
select pg_temp.issue('7b000000-0000-4000-8000-000000000002','7c000000-0000-4000-8000-000000000002',
  2500,'rec2@e.test','v-unused');
select public.claim_gift_card('v-unused','7a000000-0000-4000-8000-000000000003','rec2@e.test');

select is(pg_temp.avail('7a000000-0000-4000-8000-000000000003'), 2500::bigint, '$25.00 was claimed');

select is((select state from public.begin_gift_card_refund('7b000000-0000-4000-8000-000000000002')),
  'eligible_claimed_unused', 'a claimed but wholly unused card is refundable');
select is(pg_temp.avail('7a000000-0000-4000-8000-000000000003'), 0::bigint,
  'THE VALUE IS FROZEN BEFORE STRIPE IS ASKED — it cannot be spent mid-refund');
select is(pg_temp.ledger('7a000000-0000-4000-8000-000000000003'), 2500::bigint,
  'but the ledger still records it, pending the provider result');

-- Frozen value cannot fund a checkout.
insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
  subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('7c000000-0000-4000-8000-0000000000f2','7a000000-0000-4000-8000-000000000003',
  'r@e.test','P','stripe','pending',1299,0,1299,0,1299,'USD');
select is(public.reserve_credit_lots('7a000000-0000-4000-8000-000000000003',
  '7c000000-0000-4000-8000-0000000000f2', 1299), 0::bigint,
  'and no new reservation can touch it');

select public.mark_gift_card_refund_pending(
  (select id from public.gift_card_refunds where gift_card_id='7b000000-0000-4000-8000-000000000002'));
select is((select reversed_cents from public.complete_gift_card_refund(
  (select id from public.gift_card_refunds where gift_card_id='7b000000-0000-4000-8000-000000000002'),
  're_unused', 2500)), 2500::bigint, 'the confirmed refund reverses EXACTLY $25.00');

select is(pg_temp.ledger('7a000000-0000-4000-8000-000000000003'), 0::bigint,
  'the balance is exactly zero');
select ok(pg_temp.ledger('7a000000-0000-4000-8000-000000000003') >= 0, 'NO NEGATIVE BALANCE');
select is((select remaining_cents from public.store_credit_lots
  where gift_card_id='7b000000-0000-4000-8000-000000000002'), 0::bigint, 'the lot is emptied');
select is((select status::text from public.gift_cards where id='7b000000-0000-4000-8000-000000000002'),
  'void', 'and the card is void');

-- Replay reverses nothing twice.
select is((select outcome from public.complete_gift_card_refund(
  (select id from public.gift_card_refunds where gift_card_id='7b000000-0000-4000-8000-000000000002'),
  're_unused', 2500)), 'already_completed', 'a replay reverses nothing twice');
select is(pg_temp.ledger('7a000000-0000-4000-8000-000000000003'), 0::bigint,
  'and the balance stays at zero, never below');

-- ===========================================================================
-- C. CLAIMED AND PARTIALLY SPENT — review, never an automatic refund
-- ===========================================================================
select pg_temp.issue('7b000000-0000-4000-8000-000000000003','7c000000-0000-4000-8000-000000000003',
  2500,'rec3@e.test','v-spent');
select public.claim_gift_card('v-spent','7a000000-0000-4000-8000-000000000004','rec3@e.test');

-- Spend $12.99 on a real product order.
insert into public.orders (id,user_id,buyer_email,minecraft_username,minecraft_uuid,provider,status,
  subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
select '7c000000-0000-4000-8000-0000000000a3','7a000000-0000-4000-8000-000000000004','r@e.test','P',
  (select minecraft_uuid from public.minecraft_account_links where user_id='7a000000-0000-4000-8000-000000000004'),
  'stripe','pending',1299,0,1299,0,1299,'USD';
insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
select '7c000000-0000-4000-8000-0000000000a3', id, jsonb_build_object('slug','realvip-3m'),1,1299,1299
from public.products where slug='realvip-3m';
select public.reserve_store_credit_for_order('7c000000-0000-4000-8000-0000000000a3',
  '7a000000-0000-4000-8000-000000000004', 1299);
select public.complete_store_credit_only_order('7c000000-0000-4000-8000-0000000000a3',
  '7a000000-0000-4000-8000-000000000004');

select is(pg_temp.avail('7a000000-0000-4000-8000-000000000004'), 1201::bigint,
  '$25.00 claimed, $12.99 spent, $12.01 remains');

select is((select state from public.begin_gift_card_refund('7b000000-0000-4000-8000-000000000003')),
  'review_required', 'a partially spent card is NOT automatically refundable');
select is((select review_reason from public.gift_card_refunds
  where gift_card_id='7b000000-0000-4000-8000-000000000003'), 'gift_card_claimed_partially_spent',
  'with the correct reason');
select is((select count(*)::integer from public.order_refunds
  where order_id='7c000000-0000-4000-8000-000000000003'), 0,
  'NO EXTERNAL REFUND WAS ISSUED');
select is(pg_temp.avail('7a000000-0000-4000-8000-000000000004'), 1201::bigint,
  'the remaining value is untouched');
select ok(pg_temp.ledger('7a000000-0000-4000-8000-000000000004') >= 0, 'no negative balance');

-- The delivered product is preserved.
select ok(exists(select 1 from public.entitlements e
  join public.order_items oi on oi.id=e.order_item_id
  where oi.order_id='7c000000-0000-4000-8000-0000000000a3'
    and e.entitlement_key='product:realvip-3m' and e.status='active'),
  'THE DELIVERED REALVIP IS NOT REVOKED');
select is((select count(*)::integer from public.reward_queue rq
  join public.order_items oi on oi.id=rq.source_id
  where oi.order_id='7c000000-0000-4000-8000-0000000000a3'), 1,
  'and its RealCore reward stands');

-- The review names the downstream order.
select ok(exists(select 1 from public.payment_reviews
  where reason='gift_card_claimed_partially_spent' and detail->>'priority'='high'),
  'a high-priority review was created');
select is((select count(*)::integer from public.gift_card_downstream_funding(
  '7b000000-0000-4000-8000-000000000003')), 1::integer, 'and the funded order is linked');

-- A second request does not create a second review or a second refund row.
select is((select state from public.begin_gift_card_refund('7b000000-0000-4000-8000-000000000003')),
  'review_required', 'a repeated request returns the same live refund');
select is((select count(*)::integer from public.gift_card_refunds
  where gift_card_id='7b000000-0000-4000-8000-000000000003'), 1, 'with no duplicate row');

-- ===========================================================================
-- D. PARTIAL REQUEST and other refusals
-- ===========================================================================
select pg_temp.issue('7b000000-0000-4000-8000-000000000004','7c000000-0000-4000-8000-000000000004',
  2500,'rec4@e.test','v-partial');

select is((select state from public.begin_gift_card_refund('7b000000-0000-4000-8000-000000000004', 1000)),
  'review_required', 'A PARTIAL REQUEST IS NEVER AUTOMATIC');
select is((select review_reason from public.gift_card_refunds
  where gift_card_id='7b000000-0000-4000-8000-000000000004'), 'gift_card_partial_refund_requested',
  'it goes to review');
select is(pg_temp.credstate('7b000000-0000-4000-8000-000000000004'), 'active',
  'and a review does NOT invalidate the credential');

select pg_temp.issue('7b000000-0000-4000-8000-000000000005','7c000000-0000-4000-8000-000000000005',
  2500,'rec4@e.test','v-excess');
select is((select state from public.begin_gift_card_refund('7b000000-0000-4000-8000-000000000005', 9999)),
  'rejected', 'a request above the external payment is rejected outright');
select is((select review_reason from public.gift_card_refunds
  where gift_card_id='7b000000-0000-4000-8000-000000000005'), 'exceeds_external_payment', 'with the reason');

-- The completion ceiling holds independently.
select pg_temp.issue('7b000000-0000-4000-8000-000000000006','7c000000-0000-4000-8000-000000000006',
  2500,'rec4@e.test','v-ceiling');
select public.begin_gift_card_refund('7b000000-0000-4000-8000-000000000006');
select public.mark_gift_card_refund_pending(
  (select id from public.gift_card_refunds where gift_card_id='7b000000-0000-4000-8000-000000000006'));
select is((select outcome from public.complete_gift_card_refund(
  (select id from public.gift_card_refunds where gift_card_id='7b000000-0000-4000-8000-000000000006'),
  're_over', 9999)), 'exceeds_eligible',
  'a provider amount above the eligible ceiling is REFUSED, not recorded');
select is((select count(*)::integer from public.order_refunds
  where order_id='7c000000-0000-4000-8000-000000000006'), 0, 'and nothing is written');

-- The per-order ledger has its own ceiling and fail-closed inputs.
select is((select outcome from public.record_order_refund(
  '7c000000-0000-4000-8000-000000000006','re_x',-500,'USD',false)), 'negative_or_missing_amount',
  'a negative refund is refused');
select is((select outcome from public.record_order_refund(
  '7c000000-0000-4000-8000-000000000006','re_x',2500,'EUR',false)), 'currency_mismatch',
  'a wrong-currency refund is refused');

-- ===========================================================================
-- E. DISPUTES
-- ===========================================================================
-- Unclaimed dispute.
select pg_temp.issue('7b000000-0000-4000-8000-000000000007','7c000000-0000-4000-8000-000000000007',
  2500,'rec4@e.test','v-dispute-unclaimed');

select is((select outcome from public.record_gift_card_dispute(
  '7b000000-0000-4000-8000-000000000007','evt_d1',2500)), 'unclaimed_blocked',
  'a dispute on an unclaimed card blocks it');
select is(pg_temp.credstate('7b000000-0000-4000-8000-000000000007'), 'invalidated',
  'the credential is invalidated');
select is((select outcome from public.claim_gift_card('v-dispute-unclaimed',
  '7a000000-0000-4000-8000-000000000005','rec4@e.test')), 'invalid',
  'AND THE CARD CANNOT BE CLAIMED');
select is((select count(*)::integer from public.payment_reviews where provider_event_id='evt_d1'), 1,
  'exactly one review');

-- Replay.
select is((select outcome from public.record_gift_card_dispute(
  '7b000000-0000-4000-8000-000000000007','evt_d1',2500)), 'already_disputed', 'a replay is inert');
select is((select count(*)::integer from public.payment_reviews where provider_event_id='evt_d1'), 1,
  'and creates no second review');

-- Claimed dispute with remaining value: freeze the remainder only.
select is((select frozen_cents from public.record_gift_card_dispute(
  '7b000000-0000-4000-8000-000000000003','evt_d2',2500)), 1201::bigint,
  'a dispute on a partly spent card FREEZES THE $12.01 THAT REMAINS');
select is(pg_temp.avail('7a000000-0000-4000-8000-000000000004'), 0::bigint,
  'and it becomes unspendable');
select is((select downstream_orders from public.record_gift_card_dispute(
  '7b000000-0000-4000-8000-000000000003','evt_d2b',2500)), 0::integer,
  'a second dispute event is inert');
select ok(exists(select 1 from public.payment_reviews
  where reason='gift_card_dispute_downstream_spend' and detail->>'downstream_orders'='1'),
  'the downstream funded order is linked for review');
select ok(exists(select 1 from public.entitlements e
  join public.order_items oi on oi.id=e.order_item_id
  where oi.order_id='7c000000-0000-4000-8000-0000000000a3' and e.status='active'),
  'ALREADY SPENT VALUE IS NOT CLAWED BACK — the product stands');

-- Dispute won: unfreeze exactly once.
select is((select unfrozen_cents from public.resolve_gift_card_dispute(
  '7b000000-0000-4000-8000-000000000003','evt_d3','won')), 1201::bigint,
  'winning the dispute unfreezes the $12.01');
select is(pg_temp.avail('7a000000-0000-4000-8000-000000000004'), 1201::bigint,
  'and it is spendable again');
select is((select outcome from public.resolve_gift_card_dispute(
  '7b000000-0000-4000-8000-000000000003','evt_d3','won')), 'already_closed',
  'a replayed closure is inert');
select is(pg_temp.avail('7a000000-0000-4000-8000-000000000004'), 1201::bigint,
  'UNFROZEN EXACTLY ONCE — no value was created');

-- Dispute lost: stays frozen.
select pg_temp.issue('7b000000-0000-4000-8000-000000000008','7c000000-0000-4000-8000-000000000008',
  500,'rec4@e.test','v-lost');
select public.claim_gift_card('v-lost','7a000000-0000-4000-8000-000000000005','rec4@e.test');
select public.record_gift_card_dispute('7b000000-0000-4000-8000-000000000008','evt_d4',500);
select is((select outcome from public.resolve_gift_card_dispute(
  '7b000000-0000-4000-8000-000000000008','evt_d5','lost')), 'lost_frozen',
  'losing the dispute keeps the value frozen');
select is(pg_temp.avail('7a000000-0000-4000-8000-000000000005'), 0::bigint,
  'the value stays unspendable');
select ok(pg_temp.ledger('7a000000-0000-4000-8000-000000000005') >= 0,
  'and NO NEGATIVE BALANCE is created');
select ok(exists(select 1 from public.payment_reviews
  where provider_event_id='evt_d5' and detail->>'requires_review'='true'),
  'review remains required');

-- An unknown closure fails closed.
select pg_temp.issue('7b000000-0000-4000-8000-000000000009','7c000000-0000-4000-8000-000000000009',
  500,'rec4@e.test','v-unknown');
select public.record_gift_card_dispute('7b000000-0000-4000-8000-000000000009','evt_d6',500);
select is((select outcome from public.resolve_gift_card_dispute(
  '7b000000-0000-4000-8000-000000000009','evt_d7','something_else')), 'unknown_held',
  'AN UNKNOWN CLOSURE DOES NOT GUESS');

-- A refund requested during an open dispute goes to review.
-- A card frozen by a LOST dispute must not read as refundable claimed-unused
-- value: the chargeback already took the money.
select is((select state from public.begin_gift_card_refund('7b000000-0000-4000-8000-000000000008')),
  'review_required', 'a refund on frozen or disputed value is a conflict for a human');

-- ===========================================================================
-- F. Nothing is client-reachable
-- ===========================================================================
select is((select count(*)::integer from information_schema.role_table_grants
  where table_schema='public' and table_name in ('gift_card_refunds','order_refunds')
    and grantee in ('anon','authenticated','PUBLIC')), 0,
  'no client role can read refund records');
select is((select count(*)::integer from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  cross join (values ('anon'),('authenticated'),('public')) r(rolname)
  where n.nspname='public'
    and p.proname in ('begin_gift_card_refund','complete_gift_card_refund','record_gift_card_dispute',
                      'resolve_gift_card_dispute','record_order_refund','gift_card_downstream_funding')
    and has_function_privilege(r.rolname, p.oid, 'execute')), 0,
  'and no client role can execute any refund or dispute function');

select * from finish();
rollback;
