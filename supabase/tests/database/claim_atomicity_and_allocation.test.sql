-- Two things that only matter when something goes wrong or when an account
-- holds more than one kind of credit.
--
-- 1. CLAIM DURABILITY. The confirmation email is created by the claim
--    transaction, so "value granted" and "the recipient will be told" are one
--    fact. If the outbox write fails, the claim rolls back and the link still
--    works.
--
-- 2. ALLOCATION POLICY. Gift-origin credit is spent before older non-gift
--    credit. This is an owner-reviewable product decision, not a legal
--    requirement, and it is asserted here so it cannot drift silently.

begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id,email) values
  ('5a000000-0000-4000-8000-000000000001','a1@e.test'),
  ('5a000000-0000-4000-8000-000000000002','a2@e.test'),
  ('5a000000-0000-4000-8000-000000000003','a3@e.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like '5a000000%' on conflict do nothing;

create or replace function pg_temp.issue(p_card uuid, p_cents integer, p_email text, p_verifier text)
returns void language sql as $$
  insert into public.gift_cards (id,original_balance_cents,balance_cents,currency,
    purchaser_user_id,status,recipient_email,public_ref)
  values (p_card,p_cents,p_cents,'USD','5a000000-0000-4000-8000-000000000001','active',p_email,
    'RFG-'||upper(right(replace(p_card::text,'-',''),10)));
  insert into public.gift_card_claim_credentials (gift_card_id,verifier,masked_suffix)
  values (p_card,p_verifier,'WXYZ');
$$;

create or replace function pg_temp.avail(p_user uuid) returns bigint language sql as $$
  select public.gift_origin_available(p_user)
$$;

create or replace function pg_temp.ledger(p_user uuid) returns bigint language sql as $$
  select coalesce(sum(delta_cents),0) from public.store_credit_ledger where user_id = p_user
$$;

-- ===========================================================================
-- 1. THE CONFIRMATION IS PART OF THE CLAIM
-- ===========================================================================
select pg_temp.issue('5b000000-0000-4000-8000-000000000001', 2500, 'a2@e.test', 'verif-atomic-1');

select is((select outcome from public.claim_gift_card(
  'verif-atomic-1','5a000000-0000-4000-8000-000000000002','a2@e.test')), 'claimed',
  'the recipient claims');

select is((select count(*)::integer from public.email_deliveries
  where idempotency_key='gift_card_claimed:5b000000-0000-4000-8000-000000000001'), 1,
  'THE CONFIRMATION OUTBOX ROW EXISTS, created by the claim transaction itself');
select is((select template from public.email_deliveries
  where idempotency_key='gift_card_claimed:5b000000-0000-4000-8000-000000000001'), 'gift_card_claimed',
  'with the right template');
select is((select recipient from public.email_deliveries
  where idempotency_key='gift_card_claimed:5b000000-0000-4000-8000-000000000001'), 'a2@e.test',
  'addressed to the claiming account');
select is((select (params->>'amount_cents') from public.email_deliveries
  where idempotency_key='gift_card_claimed:5b000000-0000-4000-8000-000000000001'), '2500',
  'carrying the credited amount');
select is((select (params->>'balance_cents') from public.email_deliveries
  where idempotency_key='gift_card_claimed:5b000000-0000-4000-8000-000000000001'), '2500',
  'and the resulting balance');
select ok((select params::text from public.email_deliveries
  where idempotency_key='gift_card_claimed:5b000000-0000-4000-8000-000000000001')
  !~* '(secret|verifier|ciphertext)',
  'and NO claim secret — it has just been spent');

-- A same-account replay creates no second email.
select is((select outcome from public.claim_gift_card(
  'verif-atomic-1','5a000000-0000-4000-8000-000000000002','a2@e.test')), 'already_claimed_by_you',
  'a replay is an idempotent success');
select is((select count(*)::integer from public.email_deliveries
  where idempotency_key='gift_card_claimed:5b000000-0000-4000-8000-000000000001'), 1,
  'and creates NO duplicate email');
select is(pg_temp.avail('5a000000-0000-4000-8000-000000000002'), 2500::bigint,
  'and no extra value');

-- ===========================================================================
-- 2. AN OUTBOX FAILURE ROLLS THE WHOLE CLAIM BACK
-- ===========================================================================
-- Pre-occupying the idempotency key makes the claim's insert violate the unique
-- constraint — the same way a genuine write failure would.
select pg_temp.issue('5b000000-0000-4000-8000-000000000002', 1000, 'a3@e.test', 'verif-atomic-2');

insert into public.email_deliveries (idempotency_key, template, recipient, params)
values ('gift_card_claimed:5b000000-0000-4000-8000-000000000002','gift_card_claimed','squatter@e.test','{}'::jsonb);

select throws_ok(
  $$ select * from public.claim_gift_card('verif-atomic-2','5a000000-0000-4000-8000-000000000003','a3@e.test') $$,
  '23505',
  null,
  'a failed confirmation write ABORTS the claim'
);

-- Everything the claim would have done is gone.
select is((select state from public.gift_card_claim_credentials where verifier='verif-atomic-2'), 'active',
  'THE CREDENTIAL IS STILL ACTIVE — the recipient''s link still works');
select is((select status::text from public.gift_cards where id='5b000000-0000-4000-8000-000000000002'), 'active',
  'the card is still unclaimed');
select is((select count(*)::integer from public.store_credit_lots
  where gift_card_id='5b000000-0000-4000-8000-000000000002'), 0,
  'NO credit lot was created');
select is(pg_temp.ledger('5a000000-0000-4000-8000-000000000003'), 0::bigint,
  'NO credit was granted');

-- Clear the obstruction; the retry grants exactly once.
delete from public.email_deliveries
where idempotency_key='gift_card_claimed:5b000000-0000-4000-8000-000000000002'
  and recipient='squatter@e.test';

select is((select outcome from public.claim_gift_card(
  'verif-atomic-2','5a000000-0000-4000-8000-000000000003','a3@e.test')), 'claimed',
  'THE RETRY SUCCEEDS');
select is(pg_temp.avail('5a000000-0000-4000-8000-000000000003'), 1000::bigint,
  'granting the value exactly once');
select is((select count(*)::integer from public.email_deliveries
  where idempotency_key='gift_card_claimed:5b000000-0000-4000-8000-000000000002'), 1,
  'with exactly one confirmation');

-- ===========================================================================
-- 3. ALLOCATION POLICY: gift-origin credit is spent first
-- ===========================================================================
-- OWNER-REVIEWABLE PRODUCT POLICY, not a legal requirement. Spending
-- gift-origin value first keeps the remaining balance's provenance simple and
-- means a refund restores to the lot it came from. The alternative — spending
-- promotional credit first — would leave gift-origin value sitting longest,
-- which is defensible too. This asserts the choice so it cannot drift.
select pg_temp.issue('5b000000-0000-4000-8000-000000000003', 1000, 'a1@e.test', 'verif-alloc');
select public.claim_gift_card('verif-alloc','5a000000-0000-4000-8000-000000000001','a1@e.test');

-- Older credit with NO lot: a refund or a manual grant from before gift cards.
insert into public.store_credit_ledger (user_id,delta_cents,source,source_ref,idempotency_key,note)
values ('5a000000-0000-4000-8000-000000000001',2000,'manual_grant','goodwill','manual:alloc-1','goodwill');

select is(pg_temp.ledger('5a000000-0000-4000-8000-000000000001'), 3000::bigint,
  'the account holds $30.00 total: $10 gift-origin and $20 unlotted');
select is(pg_temp.avail('5a000000-0000-4000-8000-000000000001'), 1000::bigint,
  'of which $10.00 is gift-origin');

insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
  subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('5c000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000001',
  'a@e.test','P','stripe','pending',1500,0,1500,0,1500,'USD');

select ok(public.reserve_store_credit_for_order('5c000000-0000-4000-8000-000000000001',
  '5a000000-0000-4000-8000-000000000001', 1500), 'a $15.00 purchase reserves');

select is((select coalesce(sum(amount_cents),0)::bigint from public.store_credit_lot_allocations
  where order_id='5c000000-0000-4000-8000-000000000001'), 1000::bigint,
  'GIFT-ORIGIN CREDIT IS ALLOCATED FIRST — all $10.00 of it');
select is(pg_temp.avail('5a000000-0000-4000-8000-000000000001'), 0::bigint,
  'gift-origin value is exhausted');
select is(pg_temp.ledger('5a000000-0000-4000-8000-000000000001'), 1500::bigint,
  'and the remaining $15.00 balance is the unlotted credit, untouched by lots');
select is((select count(*)::integer from public.store_credit_lots
  where user_id='5a000000-0000-4000-8000-000000000001' and source <> 'gift_card'), 0,
  'PROMOTIONAL CREDIT WAS NEVER CONVERTED into gift-origin value');

-- Refund restoration returns to the exact lot.
select public.consume_credit_lots('5c000000-0000-4000-8000-000000000001');
select is(public.restore_credit_lots('5c000000-0000-4000-8000-000000000001', 1000), 1000::bigint,
  'a refund restores the consumed amount');
select is((select remaining_cents from public.store_credit_lots
  where gift_card_id='5b000000-0000-4000-8000-000000000003'), 1000::bigint,
  'TO THE EXACT GIFT-ORIGIN LOT it came from');

-- ===========================================================================
-- 4. Deterministic order, and frozen lots skipped
-- ===========================================================================
select pg_temp.issue('5b000000-0000-4000-8000-000000000004', 500, 'a1@e.test', 'verif-seq-a');
select public.claim_gift_card('verif-seq-a','5a000000-0000-4000-8000-000000000001','a1@e.test');
select pg_temp.issue('5b000000-0000-4000-8000-000000000005', 500, 'a1@e.test', 'verif-seq-b');
select public.claim_gift_card('verif-seq-b','5a000000-0000-4000-8000-000000000001','a1@e.test');

select ok((select lot_seq from public.store_credit_lots where gift_card_id='5b000000-0000-4000-8000-000000000004')
        < (select lot_seq from public.store_credit_lots where gift_card_id='5b000000-0000-4000-8000-000000000005'),
  'lot_seq increases monotonically, so allocation order is reproducible');

-- Freeze the OLDEST gift lot; allocation must skip it entirely.
select public.freeze_gift_card_credit('5b000000-0000-4000-8000-000000000003','dispute');

insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
  subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('5c000000-0000-4000-8000-000000000002','5a000000-0000-4000-8000-000000000001',
  'a@e.test','P','stripe','pending',500,0,500,0,500,'USD');

select is(public.reserve_credit_lots('5a000000-0000-4000-8000-000000000001',
  '5c000000-0000-4000-8000-000000000002', 500), 500::bigint, 'a $5.00 reservation succeeds');
select is((select l.gift_card_id from public.store_credit_lot_allocations a
  join public.store_credit_lots l on l.id = a.lot_id
  where a.order_id='5c000000-0000-4000-8000-000000000002'),
  '5b000000-0000-4000-8000-000000000004'::uuid,
  'FROZEN LOT SKIPPED — the next unfrozen lot funded it, in lot_seq order');

select * from finish();
rollback;
