-- A new cash-redemption review must notify operations, exactly once.
--
-- The customer's own notification already worked. Nobody told the operator,
-- so a frozen balance could sit unreviewed indefinitely. Both notifications are
-- now created in the SAME transaction as the request and the freeze.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id,email) values ('d1000000-0000-4000-8000-000000000001','c@e.test') on conflict do nothing;
insert into public.profiles (id,email) values ('d1000000-0000-4000-8000-000000000001','c@e.test') on conflict do nothing;
insert into public.store_credit_lots (user_id,source,original_cents,remaining_cents,currency)
values ('d1000000-0000-4000-8000-000000000001','gift_card',500,500,'USD');
insert into public.store_credit_ledger (user_id,delta_cents,source,source_ref,idempotency_key,note)
values ('d1000000-0000-4000-8000-000000000001',500,'gift_card_redemption','s','s:1','seed');

-- ---- A genuinely new request ---------------------------------------------
select is((select state from public.request_cash_redemption('d1000000-0000-4000-8000-000000000001')),
  'requested', 'a new request is created');

select is((select count(*)::integer from public.email_deliveries
  where template='cash_redemption_admin_review'), 1,
  'EXACTLY ONE admin notification — the defect that let a frozen balance go unseen');

select is((select count(*)::integer from public.email_deliveries
  where template='cash_redemption_received'), 1,
  'and the customer notification still fires exactly once');

select is((select frozen_cents from public.store_credit_lots
  where user_id='d1000000-0000-4000-8000-000000000001'), 500::bigint,
  'ATOMIC: the freeze committed alongside both notifications');

select is((select recipient from public.email_deliveries
  where template='cash_redemption_admin_review'), '',
  'the admin recipient is EMPTY — resolved from configuration at send time, never stored');

select is((select idempotency_key from public.email_deliveries where template='cash_redemption_admin_review'),
  'cash_redemption_admin:' || (select id::text from public.cash_redemption_requests),
  'the idempotency key is deterministic on the request id');

-- ---- Retries and already-open --------------------------------------------
select public.request_cash_redemption('d1000000-0000-4000-8000-000000000001');
select public.request_cash_redemption('d1000000-0000-4000-8000-000000000001');

select is((select count(*)::integer from public.email_deliveries
  where template='cash_redemption_admin_review'), 1,
  'RETRIES DO NOT SPAM the operations mailbox');
select is((select count(*)::integer from public.email_deliveries
  where template='cash_redemption_received'), 1, 'nor the customer');
select is((select count(*)::integer from public.cash_redemption_requests), 1,
  'and no second request row was created');
select is((select frozen_cents from public.store_credit_lots
  where user_id='d1000000-0000-4000-8000-000000000001'), 500::bigint,
  'and the value was not frozen twice');

-- ---- No secret material ---------------------------------------------------
select ok((select params::text not like '%verifier%'
             and params::text not like '%ciphertext%'
             and params::text not like '%RFG-%'
           from public.email_deliveries where template='cash_redemption_admin_review'),
  'the admin notification carries no gift-card secret material');

-- ---- The queue is the source of truth -------------------------------------
update public.email_deliveries set delivery_outcome='failed_permanent'
where template='cash_redemption_admin_review';

select is((select count(*)::integer from public.staff_cash_redemption_queue(50) where is_open), 1,
  'A FAILED EMAIL DOES NOT HIDE THE REQUEST — the queue is authoritative');

select * from finish();
rollback;
