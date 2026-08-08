-- Cash-redemption notifications: outbox rows only, and only at the three
-- moments a customer should hear about.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id,email) values
  ('7a000000-0000-4000-8000-000000000001','buyer@e.test'),
  ('7a000000-0000-4000-8000-000000000002','claimant@e.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like '7a000000%' on conflict do nothing;

insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,provider_payment_id,status,
  subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
values ('7c000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000001','buyer@e.test','B','stripe','pi_mail','fulfilled',
  2500,0,2500,0,2500,'USD');
insert into public.gift_cards (id,original_balance_cents,balance_cents,currency,purchaser_user_id,purchaser_order_id,status,recipient_email,public_ref)
values ('7b000000-0000-4000-8000-000000000001',2500,2500,'USD','7a000000-0000-4000-8000-000000000001',
  '7c000000-0000-4000-8000-000000000001','active','claimant@e.test','RFG-MAIL0001');
insert into public.gift_card_claim_credentials (gift_card_id,verifier,masked_suffix)
values ('7b000000-0000-4000-8000-000000000001','v-mail','WXYZ');
select public.claim_gift_card('v-mail','7a000000-0000-4000-8000-000000000002','claimant@e.test');

delete from public.email_deliveries;

-- ===========================================================================
-- Requested
-- ===========================================================================
select public.request_cash_redemption('7a000000-0000-4000-8000-000000000002');

select is((select count(*)::integer from public.email_deliveries
  where template='cash_redemption_received'), 1,
  'A REQUEST QUEUES ONE RECEIPT');
select is((select recipient from public.email_deliveries
  where template='cash_redemption_received'), 'claimant@e.test',
  'addressed to the claimant');
select is((select params from public.email_deliveries
  where template='cash_redemption_received'), '{}'::jsonb,
  'CARRYING NO AMOUNT — a number in a payout email reads as the payout');
select is((select order_id from public.email_deliveries
  where template='cash_redemption_received'), null,
  'and no link to the purchaser''s order');

-- The request still exists and the freeze still holds: the email is a side
-- effect of the transaction, not a precondition of it.
select is((select frozen_cents from public.store_credit_lots
  where user_id='7a000000-0000-4000-8000-000000000002'), 2500::bigint,
  'the freeze is unaffected by queueing mail');

-- A duplicate request must not queue a second receipt.
select public.request_cash_redemption('7a000000-0000-4000-8000-000000000002');
select is((select count(*)::integer from public.email_deliveries
  where template='cash_redemption_received'), 1,
  'A DUPLICATE REQUEST QUEUES NOTHING FURTHER');

-- ===========================================================================
-- Intermediate states are SILENT *to the customer*
--
-- Counted over CUSTOMER templates only. A new request also notifies operations
-- (`cash_redemption_admin_review`), which is a different audience — counting
-- every outbox row would make this assertion fail for a reason that has nothing
-- to do with what the customer is told.
-- ===========================================================================
select public.resolve_cash_redemption(
  (select id from public.cash_redemption_requests where claimant_user_id='7a000000-0000-4000-8000-000000000002'),
  'eligibility_review', 'looking');
select is((select count(*)::integer from public.email_deliveries
  where template like 'cash_redemption_%' and template <> 'cash_redemption_admin_review'), 1,
  'eligibility_review sends NOTHING to the customer');

select public.resolve_cash_redemption(
  (select id from public.cash_redemption_requests where claimant_user_id='7a000000-0000-4000-8000-000000000002'),
  'eligible', 'qualifies');
select is((select count(*)::integer from public.email_deliveries
  where template like 'cash_redemption_%' and template <> 'cash_redemption_admin_review'), 1,
  'and NEITHER DOES "eligible" — it is not a promise we have made');

select public.resolve_cash_redemption(
  (select id from public.cash_redemption_requests where claimant_user_id='7a000000-0000-4000-8000-000000000002'),
  'manual_payout_required', 'queue for payment');
select is((select count(*)::integer from public.email_deliveries
  where template like 'cash_redemption_%' and template <> 'cash_redemption_admin_review'), 1,
  'nor does manual_payout_required');

-- ===========================================================================
-- Completed — only after a person actually paid
-- ===========================================================================
select public.resolve_cash_redemption(
  (select id from public.cash_redemption_requests where claimant_user_id='7a000000-0000-4000-8000-000000000002'),
  'completed', 'paid by bank transfer', 2500);

select is((select count(*)::integer from public.email_deliveries
  where template='cash_redemption_completed'), 1,
  'COMPLETION QUEUES EXACTLY ONE MESSAGE');
select is((select params from public.email_deliveries
  where template='cash_redemption_completed'), '{}'::jsonb,
  'with no amount and no payment details');

-- ===========================================================================
-- Closed without a payout
-- ===========================================================================
delete from public.email_deliveries;
-- More gift-origin value on the SAME lot: one lot per card is enforced by a
-- unique index, so a second card would be needed to make a second lot.
--
-- The LEDGER is credited to match. Eligibility is now bounded by the ledger as
-- well as the lot (see 202608100002 — a lot richer than the account's actual
-- balance is how the same cent got both spent and paid out), so bumping the lot
-- alone would model a state the application cannot produce.
update public.store_credit_lots set remaining_cents = 1000, frozen_cents = 0
where user_id='7a000000-0000-4000-8000-000000000002';
insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
values ('7a000000-0000-4000-8000-000000000002', 1000, 'manual_grant', 'test-topup',
        'test-topup:cash-redemption-emails', 'Fixture top-up to match the lot');

select public.request_cash_redemption('7a000000-0000-4000-8000-000000000002');
select public.resolve_cash_redemption(
  (select id from public.cash_redemption_requests where claimant_user_id='7a000000-0000-4000-8000-000000000002'
   and state='requested'), 'rejected', 'not required in this jurisdiction');

select is((select count(*)::integer from public.email_deliveries
  where template='cash_redemption_closed'), 1,
  'A CLOSED REVIEW QUEUES ONE MESSAGE');
select is((select params from public.email_deliveries
  where template='cash_redemption_closed'), '{}'::jsonb,
  'AND CARRIES NO REASON — the legal reasoning stays on the review record');

-- The review note stays internal.
-- Selected by STATE, not by time: both requests are created inside one
-- transaction, so `requested_at` is identical for both and ordering by it is
-- non-deterministic.
select is((select review_note from public.cash_redemption_requests
  where claimant_user_id='7a000000-0000-4000-8000-000000000002' and state='rejected'),
  'not required in this jurisdiction',
  'the reasoning is recorded for us, not sent to them');

select * from finish();
rollback;
