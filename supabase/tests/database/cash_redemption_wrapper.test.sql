-- The cash-redemption wrapper/core architecture, and its notifications.
--
-- WHAT THIS PROTECTS
-- ==================
-- `request_cash_redemption` is a thin WRAPPER. It delegates the money decision
-- to `request_cash_redemption_core` and then enqueues the claimant's email.
-- That split is load-bearing in two directions:
--
--   * the locking and the eligibility clamp live in core, so anything that
--     replaces core changes the financial behaviour of the live path; and
--   * the email lives in the wrapper, so anything that replaces the wrapper
--     can silently stop notifying the claimant.
--
-- The application calls the WRAPPER. A change that leaves core correct but
-- detaches the wrapper from it would make the financial safeguards dead code on
-- the only path that runs — without failing a signature check, a grant check,
-- or a smoke test that merely looks for the functions' existence.
--
-- WHY THESE ASSERT BEHAVIOUR, NOT TEXT
-- ====================================
-- A `prosrc LIKE '%...%'` probe cannot distinguish "the wrapper is gone" from
-- "the wrapper delegates differently", and it proves nothing about whether an
-- email row was actually written. The structural assertions below are paired
-- with behavioural ones that run the real functions and inspect the outbox.
--
-- Runs against the current schema. No migration beyond 202608100002 is needed.

begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email)
values ('c1000000-0000-4000-8000-000000000001', 'w@e.test')
on conflict do nothing;
insert into public.profiles (id, email)
values ('c1000000-0000-4000-8000-000000000001', 'w@e.test')
on conflict do nothing;

-- ===========================================================================
-- 1. The wrapper delegates to core
-- ===========================================================================

select is(
  (select count(*)::integer from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_cash_redemption'),
  1, 'the wrapper exists exactly once');

select is(
  (select count(*)::integer from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_cash_redemption_core'),
  1, 'core exists exactly once');

select is(
  (select count(*)::integer from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enqueue_cash_redemption_email'),
  1, 'the email helper exists exactly once');

select ok(
  (select prosrc like '%request_cash_redemption_core%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_cash_redemption'),
  'THE WRAPPER DELEGATES TO CORE — otherwise core''s safeguards never run');

select ok(
  (select prosrc like '%enqueue_cash_redemption_email%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_cash_redemption'),
  'the wrapper is the layer that notifies the claimant');

-- ===========================================================================
-- 2. Core takes BOTH advisory locks
--
-- Consistent ordering with `reserve_store_credit_for_order` is what keeps a
-- freeze and a spend from interleaving. One missing lock reopens that race.
-- ===========================================================================

select ok(
  (select prosrc like '%storecredit:%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_cash_redemption_core'),
  'core takes the storecredit advisory lock');

select ok(
  (select prosrc like '%creditlots:%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_cash_redemption_core'),
  'core takes the creditlots advisory lock');

select ok(
  (select prosrc like '%storecredit:%' and prosrc like '%creditlots:%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reserve_store_credit_for_order'),
  'and the competing spend path takes the SAME two locks');

-- ===========================================================================
-- 3. The eligible amount is capped by BOTH bounds
--
-- The lot records provenance; the ledger records the balance. A reservation
-- that consumed ledger credit without a matching lot allocation would leave the
-- lot looking richer than the account is, and freezing that difference is how
-- one cent could be both spent and paid out.
-- ===========================================================================

-- Lot says 5000 is unfrozen, but the ledger only holds 1000.
insert into public.store_credit_lots (user_id, source, original_cents, remaining_cents, currency)
values ('c1000000-0000-4000-8000-000000000001', 'gift_card', 5000, 5000, 'USD');
insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
values ('c1000000-0000-4000-8000-000000000001', 1000, 'gift_card_redemption', 't', 't:clamp', 'seed');

select is(
  (select state from public.request_cash_redemption('c1000000-0000-4000-8000-000000000001')),
  'requested', 'a valid request is created');

select is(
  (select frozen_cents from public.store_credit_lots
   where user_id = 'c1000000-0000-4000-8000-000000000001'),
  1000::bigint,
  'THE LEDGER BOUND HOLDS — froze the ledger''s 1000, not the lot''s 5000');

select is(
  (select requested_cents from public.cash_redemption_requests
   where claimant_user_id = 'c1000000-0000-4000-8000-000000000001'),
  1000::bigint, 'and the request records the clamped amount');

-- ===========================================================================
-- 4. Exactly one notification per new request
-- ===========================================================================

select is(
  (select count(*)::integer from public.email_deliveries
   where template = 'cash_redemption_received'),
  1, 'a valid new request queues EXACTLY ONE cash_redemption_received email');

-- ===========================================================================
-- 5. Repeating an open request is inert
-- ===========================================================================

select is(
  (select reason from public.request_cash_redemption('c1000000-0000-4000-8000-000000000001')),
  'already_open', 'a repeat returns the EXISTING request');

select is(
  (select frozen_cents from public.store_credit_lots
   where user_id = 'c1000000-0000-4000-8000-000000000001'),
  1000::bigint, 'and does NOT freeze the value a second time');

select is(
  (select count(*)::integer from public.email_deliveries
   where template = 'cash_redemption_received'),
  1, 'and does NOT enqueue a second email');

-- ===========================================================================
-- 6. resolve_cash_redemption notifies on terminal states, idempotently
-- ===========================================================================

-- Rejecting releases the freeze and tells the claimant it closed.
select public.resolve_cash_redemption(
  (select id from public.cash_redemption_requests
   where claimant_user_id = 'c1000000-0000-4000-8000-000000000001'),
  'rejected', 'not eligible in this jurisdiction');

select is(
  (select count(*)::integer from public.email_deliveries
   where template = 'cash_redemption_closed'),
  1, 'a rejected request sends cash_redemption_closed');

-- A completed payout, on a second request that reaches the payout state.
select public.request_cash_redemption('c1000000-0000-4000-8000-000000000001');
select public.resolve_cash_redemption(
  (select id from public.cash_redemption_requests
   where claimant_user_id = 'c1000000-0000-4000-8000-000000000001'
     and state = 'requested'),
  'manual_payout_required', 'payout arranged');
select public.resolve_cash_redemption(
  (select id from public.cash_redemption_requests
   where claimant_user_id = 'c1000000-0000-4000-8000-000000000001'
     and state = 'manual_payout_required'),
  'completed', 'paid by hand', 1000);

select is(
  (select count(*)::integer from public.email_deliveries
   where template = 'cash_redemption_completed'),
  1, 'a completed request sends cash_redemption_completed');

select * from finish();
rollback;
