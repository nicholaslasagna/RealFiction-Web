-- Stored value: claim exactly once, spend partially, refund to the right lot,
-- freeze on dispute, and reconcile to the cent.
--
-- These are the assertions that decide whether real money is safe. Every one of
-- them runs against the real migrated functions.

begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

insert into auth.users (id,email) values
  ('9a000000-0000-4000-8000-000000000001','buyer@e.test'),
  ('9a000000-0000-4000-8000-000000000002','recipient@e.test'),
  ('9a000000-0000-4000-8000-000000000003','stranger@e.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like '9a000000%' on conflict do nothing;

-- A paid, issued gift card bound to a recipient, with an active credential.
create or replace function pg_temp.issue(p_card uuid, p_cents integer, p_recipient text, p_verifier text)
returns void language plpgsql as $$
begin
  insert into public.gift_cards (
    id, code_hash, original_balance_cents, balance_cents, currency,
    purchaser_user_id, status, recipient_email, public_ref
  )
  values (
    p_card, 'legacy-unused-' || p_card::text, p_cents, p_cents, 'USD',
    '9a000000-0000-4000-8000-000000000001', 'active', p_recipient,
    'RFG-' || upper(right(replace(p_card::text,'-',''), 10))
  );
  insert into public.gift_card_claim_credentials (gift_card_id, verifier, masked_suffix)
  values (p_card, p_verifier, 'ABCD');
end; $$;

create or replace function pg_temp.lot(p_card uuid) returns public.store_credit_lots
language sql as $$ select * from public.store_credit_lots where gift_card_id = p_card $$;

create or replace function pg_temp.spendable(p_user uuid) returns bigint language sql as $$
  select spendable_cents from public.store_credit_lot_balance(p_user)
$$;

-- ===========================================================================
-- 1. CLAIM — exactly once, full value, correct recipient
-- ===========================================================================
select pg_temp.issue('9b000000-0000-4000-8000-000000000001', 2500, 'recipient@e.test', 'verifier-A');

select is((select outcome from public.claim_gift_card('verifier-A',
  '9a000000-0000-4000-8000-000000000002','recipient@e.test')), 'claimed',
  'the bound recipient can claim');
select is((select original_cents from pg_temp.lot('9b000000-0000-4000-8000-000000000001')), 2500::bigint,
  'the FULL face value becomes a gift-origin credit lot');
select is(pg_temp.spendable('9a000000-0000-4000-8000-000000000002'), 2500::bigint,
  'and it is spendable');
select is((select gift_origin_cents from public.store_credit_lot_balance(
  '9a000000-0000-4000-8000-000000000002')), 2500::bigint, 'tracked as gift-origin, not generic credit');
select is((select state from public.gift_card_claim_credentials
  where gift_card_id='9b000000-0000-4000-8000-000000000001'), 'consumed',
  'the credential is single-use');

-- A second claim with the same credential yields NOTHING.
select is((select outcome from public.claim_gift_card('verifier-A',
  '9a000000-0000-4000-8000-000000000003','stranger@e.test')), 'invalid',
  'A REPLAYED CLAIM GETS NOTHING');
select is((select count(*)::integer from public.store_credit_lots
  where gift_card_id='9b000000-0000-4000-8000-000000000001'), 1,
  'and creates no second lot');
select is(pg_temp.spendable('9a000000-0000-4000-8000-000000000003'), 0::bigint,
  'the stranger received no value');

-- The original claimer replaying gets an idempotent already-claimed result:
-- they are entitled to know their own card landed. A DIFFERENT account gets a
-- flat "invalid" (asserted above), so the response cannot be used to probe
-- whether a guessed credential belongs to a real card.
select is((select outcome from public.claim_gift_card('verifier-A',
  '9a000000-0000-4000-8000-000000000002','recipient@e.test')), 'already_claimed_by_you',
  'the claimer replaying gets an idempotent already-claimed result');
select is(pg_temp.spendable('9a000000-0000-4000-8000-000000000002'), 2500::bigint,
  'and no extra value was created');

-- ===========================================================================
-- 2. Recipient binding
-- ===========================================================================
select pg_temp.issue('9b000000-0000-4000-8000-000000000002', 5000, 'recipient@e.test', 'verifier-B');

select is((select outcome from public.claim_gift_card('verifier-B',
  '9a000000-0000-4000-8000-000000000003','stranger@e.test')), 'wrong_recipient',
  'a card addressed to someone else cannot be claimed');
select is((select state from public.gift_card_claim_credentials where verifier='verifier-B'), 'active',
  'and the refused attempt does NOT burn the credential');
select is(pg_temp.spendable('9a000000-0000-4000-8000-000000000003'), 0::bigint,
  'no value moved');

-- A rotated credential stops working the moment it is rotated.
update public.gift_card_claim_credentials
set state='rotated', invalidated_at=now(), invalidated_reason='resend'
where verifier='verifier-B';
insert into public.gift_card_claim_credentials (gift_card_id, verifier, issue_reason)
values ('9b000000-0000-4000-8000-000000000002', 'verifier-B2', 'resend');

select is((select outcome from public.claim_gift_card('verifier-B',
  '9a000000-0000-4000-8000-000000000002','recipient@e.test')), 'invalid',
  'THE OLD CREDENTIAL IS DEAD after a resend');
select is((select outcome from public.claim_gift_card('verifier-B2',
  '9a000000-0000-4000-8000-000000000002','recipient@e.test')), 'claimed',
  'the newest credential works');
select is((select count(*)::integer from public.store_credit_lots
  where user_id='9a000000-0000-4000-8000-000000000002'), 2,
  'exactly two lots for two claimed cards — rotation created no extra value');

-- ===========================================================================
-- 3. PARTIAL SPENDING — the owner's worked examples
-- ===========================================================================
-- Claim $25, spend $12.99, expect $12.01 of gift-origin value left.
create or replace function pg_temp.order_for(p_order uuid, p_user uuid, p_total integer)
returns void language sql as $$
  insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
    subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
  values (p_order,p_user,'r@e.test','T','stripe','pending',p_total,0,p_total,p_total,0,'USD');
$$;

select pg_temp.order_for('9c000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000002',1299);
select is(public.reserve_credit_lots('9a000000-0000-4000-8000-000000000002',
  '9c000000-0000-4000-8000-000000000001', 1299), 1299::bigint, 'reserves exactly $12.99');
select is(public.consume_credit_lots('9c000000-0000-4000-8000-000000000001'), 1299::bigint,
  'and consumes it at fulfilment');

-- 2500 + 5000 = 7500 claimed; 1299 spent -> 6201 left.
select is(pg_temp.spendable('9a000000-0000-4000-8000-000000000002'), 6201::bigint,
  'EXACT cent reconciliation after a partial spend');

-- Second and third purchases from the same balance.
select pg_temp.order_for('9c000000-0000-4000-8000-000000000002','9a000000-0000-4000-8000-000000000002',2399);
select is(public.reserve_credit_lots('9a000000-0000-4000-8000-000000000002',
  '9c000000-0000-4000-8000-000000000002', 2399), 2399::bigint, 'a second purchase reserves');
select is(public.consume_credit_lots('9c000000-0000-4000-8000-000000000002'), 2399::bigint, 'and consumes');
select is(pg_temp.spendable('9a000000-0000-4000-8000-000000000002'), 3802::bigint,
  'still exact after several purchases');

-- Oldest lot first, by issue sequence: the $25 card is exhausted before the
-- $50 one is touched, deterministically even though both were claimed here in
-- one transaction.
select is((select remaining_cents from pg_temp.lot('9b000000-0000-4000-8000-000000000001')), 0::bigint,
  'the oldest lot is spent first, to zero');
select is((select remaining_cents from pg_temp.lot('9b000000-0000-4000-8000-000000000002')), 3802::bigint,
  'and the newer lot carries the remainder');

-- ===========================================================================
-- 4. No overspend, no negative balance
-- ===========================================================================
select pg_temp.order_for('9c000000-0000-4000-8000-000000000003','9a000000-0000-4000-8000-000000000002',999999);
select is(public.reserve_credit_lots('9a000000-0000-4000-8000-000000000002',
  '9c000000-0000-4000-8000-000000000003', 999999), 3802::bigint,
  'a request larger than the balance reserves only what exists');
select is(pg_temp.spendable('9a000000-0000-4000-8000-000000000002'), 0::bigint, 'balance floors at zero');
select ok((select bool_and(remaining_cents >= 0) from public.store_credit_lots),
  'NO LOT CAN GO NEGATIVE');

-- The caller that could not fund its order releases; value returns intact.
select is(public.release_credit_lots('9c000000-0000-4000-8000-000000000003'), 3802::bigint,
  'releasing returns the exact amount held');
select is(pg_temp.spendable('9a000000-0000-4000-8000-000000000002'), 3802::bigint,
  'and the balance is whole again');

-- ===========================================================================
-- 5. REFUND restores to the ORIGINAL lot
-- ===========================================================================
select is(public.restore_credit_lots('9c000000-0000-4000-8000-000000000001', 1299), 1299::bigint,
  'a refund restores the spent amount');
select is((select remaining_cents from pg_temp.lot('9b000000-0000-4000-8000-000000000001')), 1299::bigint,
  'TO THE LOT IT CAME FROM — gift-origin provenance survives a refund');
select is((select gift_origin_cents from public.store_credit_lot_balance(
  '9a000000-0000-4000-8000-000000000002')), 5101::bigint,
  'and it is still gift-origin, not generic credit');

-- Refunding twice cannot restore twice.
select is(public.restore_credit_lots('9c000000-0000-4000-8000-000000000001', 1299), 0::bigint,
  'A REPLAYED REFUND RESTORES NOTHING');
select is((select remaining_cents from pg_temp.lot('9b000000-0000-4000-8000-000000000001')), 1299::bigint,
  'the lot is unchanged by the replay');
select is(public.restore_credit_lots('9c000000-0000-4000-8000-000000000002', 999999), 2399::bigint,
  'an over-large refund restores only what was actually consumed');

-- ===========================================================================
-- 6. DISPUTE freeze
-- ===========================================================================
-- Asserted against the lot's ACTUAL remaining value rather than a hardcoded
-- number: earlier sections spent and refunded, and an expectation that encodes
-- that whole history tests the test rather than the freeze.
select is(
  (select frozen_cents from public.freeze_gift_card_credit(
    '9b000000-0000-4000-8000-000000000002', 'dispute_opened')),
  (select remaining_cents from pg_temp.lot('9b000000-0000-4000-8000-000000000002')),
  'a dispute freezes exactly the remaining value of that card');
select ok((select frozen_at from public.gift_cards
  where id='9b000000-0000-4000-8000-000000000002') is not null, 'the card records the freeze');

select pg_temp.order_for('9c000000-0000-4000-8000-000000000004','9a000000-0000-4000-8000-000000000002',100);
-- Snapshot BEFORE reserving: the reservation drains the unfrozen lot, so
-- reading it inside the same assertion would compare against post-state.
create temporary table pg_temp_freeze_snapshot as
select
  (select remaining_cents from pg_temp.lot('9b000000-0000-4000-8000-000000000001')) as unfrozen_before,
  (select remaining_cents from pg_temp.lot('9b000000-0000-4000-8000-000000000002')) as frozen_before;

-- The frozen card's value is excluded; only the OTHER lot can be reserved.
select is(
  public.reserve_credit_lots('9a000000-0000-4000-8000-000000000002',
    '9c000000-0000-4000-8000-000000000004', 999999),
  (select unfrozen_before from pg_temp_freeze_snapshot),
  'FROZEN VALUE CANNOT BE SPENT — only the unfrozen lot is reservable');
select is(
  (select remaining_cents from pg_temp.lot('9b000000-0000-4000-8000-000000000002')),
  (select frozen_before from pg_temp_freeze_snapshot),
  'the frozen lot is untouched by a reservation that wanted everything');
select public.release_credit_lots('9c000000-0000-4000-8000-000000000004');

-- A claim against a frozen card is refused outright.
select pg_temp.issue('9b000000-0000-4000-8000-000000000003', 1000, 'recipient@e.test', 'verifier-C');
update public.gift_cards set frozen_at = now(), frozen_reason='dispute'
where id='9b000000-0000-4000-8000-000000000003';
select is((select outcome from public.claim_gift_card('verifier-C',
  '9a000000-0000-4000-8000-000000000002','recipient@e.test')), 'frozen',
  'a disputed card cannot be claimed');

-- Winning the dispute releases the freeze; losing it would not.
select ok(public.unfreeze_gift_card_credit('9b000000-0000-4000-8000-000000000002') >= 0,
  'a won dispute unfreezes');
select is((select frozen_cents from public.store_credit_lots
  where gift_card_id='9b000000-0000-4000-8000-000000000002'), 0::bigint, 'the freeze is lifted');

-- ===========================================================================
-- 7. Void and legacy state
-- ===========================================================================
select pg_temp.issue('9b000000-0000-4000-8000-000000000004', 1500, 'recipient@e.test', 'verifier-D');
update public.gift_cards set status='void', voided_at=now(), void_reason='refunded_before_claim'
where id='9b000000-0000-4000-8000-000000000004';
select is((select outcome from public.claim_gift_card('verifier-D',
  '9a000000-0000-4000-8000-000000000002','recipient@e.test')), 'void',
  'a voided card cannot be claimed');
select is((select count(*)::integer from public.store_credit_lots
  where gift_card_id='9b000000-0000-4000-8000-000000000004'), 0, 'and creates no value');

select is((select legacy_plaintext_codes from public.gift_card_legacy_code_migration_state()), 0,
  'a clean-slate database has NO legacy plaintext codes');

-- ===========================================================================
-- 8. Nothing is client-reachable
-- ===========================================================================
select is((select count(*)::integer from information_schema.role_table_grants
  where table_schema='public'
    and table_name in ('gift_card_claim_credentials','store_credit_lots','store_credit_lot_allocations','gift_cards')
    and grantee in ('anon','authenticated','PUBLIC')), 0,
  'NO client role can read credentials, lots, allocations, or cards');

select is((select count(*)::integer from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  cross join (values ('anon'),('authenticated'),('public')) r(rolname)
  where n.nspname='public'
    and p.proname in ('claim_gift_card','reserve_credit_lots','release_credit_lots',
                      'consume_credit_lots','restore_credit_lots','freeze_gift_card_credit',
                      'unfreeze_gift_card_credit','store_credit_lot_balance')
    and has_function_privilege(r.rolname, p.oid, 'execute')), 0,
  'and no client role can execute any stored-value function');

select * from finish();
rollback;
