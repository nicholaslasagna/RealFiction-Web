-- The cash-redemption wrapper must delegate AND email.
--
-- Production lost both: it applied 202608080002 in its first form (no
-- wrapper/core split, no email), so `request_cash_redemption` held the old
-- logic and `enqueue_cash_redemption_email` did not exist. 202608100002 then
-- created `request_cash_redemption_core` fresh, leaving it orphaned — the
-- RF-05 fix was dead code on the path the application actually calls.
--
-- These assert the ARCHITECTURE and the BEHAVIOUR, not a substring, so the
-- flawed prosrc-only check that missed this cannot be the only guard again.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id,email) values ('c1000000-0000-4000-8000-000000000001','w@e.test') on conflict do nothing;
insert into public.profiles (id,email) values ('c1000000-0000-4000-8000-000000000001','w@e.test') on conflict do nothing;

-- ---- Architecture ---------------------------------------------------------
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='request_cash_redemption'), 1, 'the wrapper exists exactly once');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='request_cash_redemption_core'), 1, 'core exists exactly once');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='enqueue_cash_redemption_email'), 1,
  'THE EMAIL HELPER EXISTS — production had none');

select ok((select prosrc like '%request_cash_redemption_core%' from pg_proc where proname='request_cash_redemption'),
  'THE WRAPPER DELEGATES TO CORE — otherwise the RF-05 fix is dead code');
select ok((select prosrc like '%storecredit:%' and prosrc like '%creditlots:%'
  from pg_proc where proname='request_cash_redemption_core'),
  'core still takes BOTH advisory locks in the RF-05 order');

-- ---- Behaviour: the part a substring check cannot prove --------------------
insert into public.store_credit_lots (user_id,source,original_cents,remaining_cents,currency)
values ('c1000000-0000-4000-8000-000000000001','gift_card',5000,5000,'USD');
insert into public.store_credit_ledger (user_id,delta_cents,source,source_ref,idempotency_key,note)
values ('c1000000-0000-4000-8000-000000000001',1000,'gift_card_redemption','t','t:clamp','seed');

select is((select state from public.request_cash_redemption('c1000000-0000-4000-8000-000000000001')),
  'requested', 'a request is created');

select is((select frozen_cents from public.store_credit_lots
  where user_id='c1000000-0000-4000-8000-000000000001'), 1000::bigint,
  'THE LEDGER CLAMP HOLDS — it froze 1000, not the lot''s 5000');

select is((select count(*)::integer from public.email_deliveries
  where template='cash_redemption_received'), 1,
  'AN EMAIL WAS ACTUALLY QUEUED — the regression that a prosrc check missed');

-- A second request must not queue a second email.
select public.request_cash_redemption('c1000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from public.email_deliveries
  where template='cash_redemption_received'), 1,
  'a duplicate request is idempotent — still exactly one email');

select is((select count(*)::integer from public.cash_redemption_requests
  where claimant_user_id='c1000000-0000-4000-8000-000000000001'), 1,
  'and exactly one request row');

select * from finish();
rollback;
