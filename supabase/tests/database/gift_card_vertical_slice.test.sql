-- The whole slice, end to end, in one transaction:
--
--   paid $25 gift-card order
--   -> issued exactly once, atomically, with both emails queued
--   -> recipient claims explicitly
--   -> $25 gift-origin credit lot
--   -> recipient buys RealVIP 3 months for $12.99
--   -> $12.01 gift-origin credit remains
--   -> an ordinary RealVIP reward is queued for RealCore
--   -> NO gift-card reward is ever queued
--
-- The last two lines are the RealCore boundary. RealCore delivers Minecraft
-- products; it must never be handed a gift card, because a gift card has
-- nothing it can grant and its existing failure path would (correctly) reject
-- it — which would show up as a delivery failure for a purchase that actually
-- succeeded.

begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id,email) values
  ('8a000000-0000-4000-8000-000000000001','buyer@e.test'),
  ('8a000000-0000-4000-8000-000000000002','recipient@e.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like '8a000000%' on conflict do nothing;

-- Verified Minecraft link for the recipient, so their RealVIP purchase can be
-- delivered by RealCore.
insert into public.minecraft_account_links (
  user_id, minecraft_username, minecraft_uuid, verification_code, status, verified_at
)
values ('8a000000-0000-4000-8000-000000000002','LittleNicholas',
        '00000000-0000-4000-8000-00000000beef','TESTCODE','verified', now())
on conflict do nothing;

-- ===========================================================================
-- 1. A paid $25 gift-card order
-- ===========================================================================
insert into public.orders (
  id, user_id, buyer_email, minecraft_username, provider, status,
  subtotal_cents, discount_cents, total_cents, store_credit_applied_cents,
  payment_due_cents, currency, metadata
)
values (
  '8b000000-0000-4000-8000-000000000001','8a000000-0000-4000-8000-000000000001',
  'buyer@e.test', null, 'stripe', 'pending',
  2500, 0, 2500, 0, 2500, 'USD',
  jsonb_build_object(
    'gift_recipient_email','recipient@e.test',
    'gift_sender_name','Nicholas',
    'gift_message','Happy birthday!'
  )
);

insert into public.order_items (order_id, product_id, product_snapshot, quantity, unit_price_cents, total_cents)
select '8b000000-0000-4000-8000-000000000001', id,
       jsonb_build_object('slug', slug, 'name', name), 1, price_cents, price_cents
from public.products where slug = 'gift-card-25';

-- The application generated a 256-bit secret, computed its keyed verifier, and
-- sealed it. Only the derived values reach the database.
select is((select outcome from public.issue_gift_card_for_order(
  '8b000000-0000-4000-8000-000000000001',
  repeat('a', 64), 'v1.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbb', 1, 'WXYZ', 'pi_gift', 'ch_gift'
)), 'issued', 'a paid gift-card order issues a card');

select is((select count(*)::integer from public.gift_cards
  where purchaser_order_id='8b000000-0000-4000-8000-000000000001'), 1,
  'exactly ONE card');
select is((select original_balance_cents from public.gift_cards
  where purchaser_order_id='8b000000-0000-4000-8000-000000000001'), 2500,
  'at the authoritative $25 face value');
select is((select recipient_email from public.gift_cards
  where purchaser_order_id='8b000000-0000-4000-8000-000000000001'), 'recipient@e.test',
  'bound to the snapshotted recipient');
select is((select status::text from public.orders where id='8b000000-0000-4000-8000-000000000001'),
  'fulfilled', 'and the order reaches its terminal state');

select is((select count(*)::integer from public.gift_card_claim_credentials c
  join public.gift_cards g on g.id = c.gift_card_id
  where g.purchaser_order_id='8b000000-0000-4000-8000-000000000001' and c.state='active'), 1,
  'exactly ONE active credential');

-- Both emails, in the same transaction as the card.
select is((select count(*)::integer from public.email_deliveries
  where order_id='8b000000-0000-4000-8000-000000000001'), 2,
  'BOTH emails are queued atomically with issuance');
select ok(exists(select 1 from public.email_deliveries
  where order_id='8b000000-0000-4000-8000-000000000001'
    and template='gift_card_purchase' and recipient='buyer@e.test'),
  'the purchaser gets a confirmation');
select ok(exists(select 1 from public.email_deliveries
  where order_id='8b000000-0000-4000-8000-000000000001'
    and template='gift_card_delivery' and recipient='recipient@e.test'),
  'the recipient gets the delivery');

-- The delivery row carries NO claim secret: the worker opens the sealed value
-- from the credential row while rendering instead.
select ok(not exists(select 1 from public.email_deliveries
  where order_id='8b000000-0000-4000-8000-000000000001'
    and params::text ~* '(secret|claim_token|verifier|ciphertext)'),
  'NO claim secret rests in the email queue');

-- THE REALCORE BOUNDARY.
select is((select count(*)::integer from public.reward_queue rq
  join public.order_items oi on oi.id = rq.source_id
  where oi.order_id='8b000000-0000-4000-8000-000000000001'), 0,
  'a gift-card purchase queues NO RealCore reward');

-- ===========================================================================
-- 2. Replay issues nothing twice
-- ===========================================================================
select is((select outcome from public.issue_gift_card_for_order(
  '8b000000-0000-4000-8000-000000000001',
  repeat('b', 64), 'v1.cccccccccccccccc.dddddddddddddddddddd', 1, 'QRST', 'pi_gift', 'ch_gift'
)), 'already_issued', 'a webhook replay issues nothing');
select is((select count(*)::integer from public.gift_cards
  where purchaser_order_id='8b000000-0000-4000-8000-000000000001'), 1,
  'still exactly one card');
select is((select count(*)::integer from public.email_deliveries
  where order_id='8b000000-0000-4000-8000-000000000001'), 2,
  'and still exactly two emails');

-- ===========================================================================
-- 3. The recipient claims explicitly
-- ===========================================================================
select is((select outcome from public.claim_gift_card(
  repeat('a', 64), '8a000000-0000-4000-8000-000000000002', 'recipient@e.test')), 'claimed',
  'the bound recipient claims');

select is((select gift_origin_cents from public.store_credit_lot_balance(
  '8a000000-0000-4000-8000-000000000002')), 2500::bigint,
  'a $25 GIFT-ORIGIN credit lot exists');
select is((select spendable_cents from public.store_credit_lot_balance(
  '8a000000-0000-4000-8000-000000000002')), 2500::bigint, 'and it is spendable');
select is((select count(*)::integer from public.store_credit_ledger
  where user_id='8a000000-0000-4000-8000-000000000002' and source='gift_card_redemption'), 1,
  'with exactly one ledger grant');

-- Claiming creates no Minecraft reward either.
select is((select count(*)::integer from public.reward_queue
  where user_id='8a000000-0000-4000-8000-000000000002'), 0,
  'CLAIMING queues no RealCore reward');

-- ===========================================================================
-- 4. The recipient buys RealVIP 3 months with that credit
-- ===========================================================================
insert into public.orders (
  id, user_id, buyer_email, minecraft_username, minecraft_uuid, provider, status,
  subtotal_cents, discount_cents, total_cents, store_credit_applied_cents,
  payment_due_cents, currency
)
values (
  '8b000000-0000-4000-8000-000000000002','8a000000-0000-4000-8000-000000000002',
  'recipient@e.test','LittleNicholas','00000000-0000-4000-8000-00000000beef',
  'gift_card','pending', 1299, 0, 1299, 1299, 0, 'USD'
);

insert into public.order_items (order_id, product_id, product_snapshot, quantity, unit_price_cents, total_cents)
select '8b000000-0000-4000-8000-000000000002', id,
       jsonb_build_object('slug', slug, 'name', name), 1, price_cents, price_cents
from public.products where slug = 'realvip-3m';

select is(public.reserve_credit_lots('8a000000-0000-4000-8000-000000000002',
  '8b000000-0000-4000-8000-000000000002', 1299), 1299::bigint,
  'the gift-origin lot funds the purchase');

select public.fulfill_paid_order('8b000000-0000-4000-8000-000000000002');
select is(public.consume_credit_lots('8b000000-0000-4000-8000-000000000002'), 1299::bigint,
  'and is consumed at fulfilment');

-- THE NUMBER THE OWNER ASKED FOR.
select is((select gift_origin_cents from public.store_credit_lot_balance(
  '8a000000-0000-4000-8000-000000000002')), 1201::bigint,
  '$25.00 claimed, $12.99 spent, $12.01 OF GIFT-ORIGIN CREDIT REMAINS');

-- The provenance survived the purchase.
select is((select source from public.store_credit_lots
  where user_id='8a000000-0000-4000-8000-000000000002'), 'gift_card',
  'the remaining value is still gift-origin, not generic credit');

-- ===========================================================================
-- 5. RealCore delivers the RealVIP product normally
-- ===========================================================================
select is((select count(*)::integer from public.reward_queue rq
  join public.order_items oi on oi.id = rq.source_id
  where oi.order_id='8b000000-0000-4000-8000-000000000002'), 1,
  'the RealVIP purchase queues exactly ONE RealCore reward');
select is((select rq.reward_key from public.reward_queue rq
  join public.order_items oi on oi.id = rq.source_id
  where oi.order_id='8b000000-0000-4000-8000-000000000002'), 'store.realvip-3m',
  'with the ordinary product reward key');
select is((select rq.minecraft_username from public.reward_queue rq
  join public.order_items oi on oi.id = rq.source_id
  where oi.order_id='8b000000-0000-4000-8000-000000000002'), 'LittleNicholas',
  'addressed to the linked Minecraft account');
select is((select status::text from public.reward_queue rq
  join public.order_items oi on oi.id = rq.source_id
  where oi.order_id='8b000000-0000-4000-8000-000000000002'), 'pending',
  'and waiting for RealCore to poll it');

-- Entitlement duration is the ordinary 3-month grant — gift-funded or not.
select ok(exists(select 1 from public.entitlements e
  join public.order_items oi on oi.id = e.order_item_id
  where oi.order_id='8b000000-0000-4000-8000-000000000002'
    and e.entitlement_key='product:realvip-3m'
    and e.status='active'
    and e.expires_at > now() + interval '85 days'
    and e.expires_at < now() + interval '95 days'),
  'the ordinary 3-month entitlement is granted, unchanged by how it was paid for');

-- And across the WHOLE slice, RealCore was handed exactly one thing.
select is((select count(*)::integer from public.reward_queue), 1,
  'ACROSS THE ENTIRE SLICE: exactly one RealCore reward, and it is the RealVIP');
select ok(not exists(select 1 from public.reward_queue where reward_key ilike '%gift%'),
  'NO gift-card reward was ever queued');

-- ===========================================================================
-- 6. The legacy door is gone
-- ===========================================================================
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='redeem_gift_card'), 0,
  'the plaintext-hash redemption RPC no longer exists');
select is((select count(*)::integer from information_schema.columns
  where table_schema='public' and table_name='gift_cards' and column_name in ('code','code_hash')), 0,
  'and neither does plaintext code storage');

select * from finish();
rollback;
