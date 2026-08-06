-- Transactional email outbox atomicity.
--
-- Sending stays asynchronous and best-effort; CREATING the outbox row does not.
-- A credit-only order has no webhook to replay, so if fulfilment committed
-- without the outbox row the confirmation would be lost forever.

begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

insert into auth.users (id, email) values ('0b000000-0000-4000-8000-000000000001', 'outbox@example.test')
on conflict (id) do nothing;
insert into public.profiles (id, email) values ('0b000000-0000-4000-8000-000000000001', 'outbox@example.test')
on conflict (id) do nothing;
insert into public.products (id, slug, category, name, description, price_cents, currency,
  fulfillment_type, duration_days, metadata, active)
values ('0b000000-0000-4000-8000-0000000000b1','outbox-1m','supporter','Outbox','d',1299,'USD',
  'subscription',30,'{"safe_reward":true}'::jsonb,true)
on conflict (slug) do update set price_cents = 1299, active = true;

insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
values ('0b000000-0000-4000-8000-000000000001', 2598, 'manual_grant', 't', 'grant:outbox', 't');

create or replace function pg_temp.mk(p_id uuid, p_provider text default 'gift_card', p_status text default 'pending')
returns uuid language plpgsql as $$
begin
  insert into public.orders (id,user_id,buyer_email,minecraft_username,minecraft_uuid,provider,status,
    subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
  values (p_id,'0b000000-0000-4000-8000-000000000001','outbox@example.test','OutboxTester',
    '00000000-0000-4000-8000-0000000b0000',p_provider::public.order_provider,p_status::public.order_status,
    1299,0,1299,case when p_provider='gift_card' then 1299 else 0 end,
    case when p_provider='gift_card' then 0 else 1299 end,'USD');
  insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
  values (p_id,'0b000000-0000-4000-8000-0000000000b1','{"slug":"outbox-1m"}'::jsonb,1,1299,1299);
  return p_id;
end; $$;

-- 1. Credit-only fulfilment creates the confirmation atomically ---------------
select pg_temp.mk('0b000000-0000-4000-8000-0000000000a1');
select is(public.complete_store_credit_only_order(
  '0b000000-0000-4000-8000-0000000000a1','0b000000-0000-4000-8000-000000000001'), true,
  'credit-only fulfilment succeeds');

select is((select count(*)::integer from public.email_deliveries
  where idempotency_key = 'order_confirmation:0b000000-0000-4000-8000-0000000000a1'), 1,
  'the confirmation outbox row is created in the same transaction');

select is((select delivery_outcome from public.email_deliveries
  where idempotency_key = 'order_confirmation:0b000000-0000-4000-8000-0000000000a1'), 'pending',
  'the outbox row is pending — no provider call happened inside the transaction');

select is((select recipient from public.email_deliveries
  where idempotency_key = 'order_confirmation:0b000000-0000-4000-8000-0000000000a1'),
  'outbox@example.test', 'it targets the order''s immutable buyer email');

select ok((select first_provider_attempt_at from public.email_deliveries
  where idempotency_key = 'order_confirmation:0b000000-0000-4000-8000-0000000000a1') is null,
  'no provider-idempotency window is opened by fulfilment');

-- 2. ROLLBACK: a failing outbox insert undoes everything ----------------------
select pg_temp.mk('0b000000-0000-4000-8000-0000000000a2');

create or replace function pg_temp.block_outbox() returns trigger language plpgsql as $$
begin
  raise exception 'simulated outbox failure';
end; $$;
create trigger block_outbox before insert on public.email_deliveries
for each row execute function pg_temp.block_outbox();

select throws_ok(
  $$ select public.complete_store_credit_only_order(
       '0b000000-0000-4000-8000-0000000000a2','0b000000-0000-4000-8000-000000000001') $$,
  'simulated outbox failure',
  'a failing outbox insert aborts the whole fulfilment');

drop trigger block_outbox on public.email_deliveries;

select is((select status from public.orders where id = '0b000000-0000-4000-8000-0000000000a2'),
  'pending', 'ROLLBACK: the order did not become fulfilled');

select is((select count(*)::integer from public.store_credit_ledger
  where idempotency_key = 'store_credit_spend:0b000000-0000-4000-8000-0000000000a2'), 0,
  'ROLLBACK: no credit was consumed');

select is((select count(*)::integer from public.entitlements
  where (metadata->>'order_id') = '0b000000-0000-4000-8000-0000000000a2'), 0,
  'ROLLBACK: no entitlement was created');

select is((select count(*)::integer from public.reward_queue
  where payload->>'order_id' = '0b000000-0000-4000-8000-0000000000a2'), 0,
  'ROLLBACK: no reward operation was created');

select is((select count(*)::integer from public.email_deliveries
  where idempotency_key = 'order_confirmation:0b000000-0000-4000-8000-0000000000a2'), 0,
  'ROLLBACK: no outbox row was created');

-- 3. Retry after the failure succeeds exactly once ----------------------------
select is(public.complete_store_credit_only_order(
  '0b000000-0000-4000-8000-0000000000a2','0b000000-0000-4000-8000-000000000001'), true,
  'the retry succeeds once the outbox is writable again');

select is((select count(*)::integer from public.store_credit_ledger
  where idempotency_key = 'store_credit_spend:0b000000-0000-4000-8000-0000000000a2'), 1,
  'the retry consumes credit exactly once');

select is((select count(*)::integer from public.email_deliveries
  where idempotency_key = 'order_confirmation:0b000000-0000-4000-8000-0000000000a2'), 1,
  'the retry creates exactly one outbox row');

-- 4. Stripe-paid fulfilment creates one delivery, replay creates none ---------
select pg_temp.mk('0b000000-0000-4000-8000-0000000000a3', 'stripe');
select public.fulfill_paid_order_with_outbox(
  '0b000000-0000-4000-8000-0000000000a3', 'pi_test_1', 'ch_test_1',
  'https://pay.stripe.com/receipts/x');

select is((select count(*)::integer from public.email_deliveries
  where idempotency_key = 'order_confirmation:0b000000-0000-4000-8000-0000000000a3'), 1,
  'Stripe fulfilment creates one confirmation delivery');

select is((select already_fulfilled from public.fulfill_paid_order_with_outbox(
  '0b000000-0000-4000-8000-0000000000a3', 'pi_test_1', 'ch_test_1', null)), true,
  'a replayed payment webhook reports already fulfilled');

select is((select count(*)::integer from public.email_deliveries
  where idempotency_key = 'order_confirmation:0b000000-0000-4000-8000-0000000000a3'), 1,
  'a replayed payment webhook creates NO duplicate delivery');

-- 4b. A NULL receipt_url must not block anything -----------------------------
-- The receipt is opportunistic enrichment read from the webhook payload; Stripe
-- often has not produced one yet. Fulfilment must be completely unaffected.
select pg_temp.mk('0b000000-0000-4000-8000-0000000000a4', 'stripe');
select public.fulfill_paid_order_with_outbox(
  '0b000000-0000-4000-8000-0000000000a4', 'pi_test_2', 'ch_test_2', null);

select is((select status from public.orders where id = '0b000000-0000-4000-8000-0000000000a4'),
  'fulfilled', 'a null receipt_url still fulfils the order');

select is((select count(*)::integer from public.entitlements
  where (metadata->>'order_id') = '0b000000-0000-4000-8000-0000000000a4'), 1,
  'a null receipt_url still creates the entitlement');

select is((select count(*)::integer from public.reward_queue
  where payload->>'order_id' = '0b000000-0000-4000-8000-0000000000a4'), 1,
  'a null receipt_url still creates the reward operation');

select is((select count(*)::integer from public.email_deliveries
  where idempotency_key = 'order_confirmation:0b000000-0000-4000-8000-0000000000a4'), 1,
  'a null receipt_url still creates the confirmation outbox row');

select ok((select stripe_receipt_url from public.orders
  where id = '0b000000-0000-4000-8000-0000000000a4') is null,
  'no receipt URL is invented when Stripe has not produced one');

-- 5. Refund outbox ------------------------------------------------------------
select is((select claimed from public.revoke_order_with_refund_outbox(
  '0b000000-0000-4000-8000-0000000000a3', 'refund:re_out_1', 'refund', 'stripe:refund.updated:succeeded',
  're_out_1', 1299, 'USD', true, 'revoked', null)), true,
  'a settled full refund claims the revocation');

select is((select count(*)::integer from public.email_deliveries
  where idempotency_key = 'refund_confirmation:re_out_1'), 1,
  'the refund confirmation delivery is created atomically with the revocation');

-- refund.created + refund.updated for the SAME refund -> one delivery.
select is((select claimed from public.revoke_order_with_refund_outbox(
  '0b000000-0000-4000-8000-0000000000a3', 'refund:re_out_1', 'refund', 'stripe:refund.created:succeeded',
  're_out_1', 1299, 'USD', true, 'revoked', null)), false,
  'a second Stripe event for the same refund claims nothing');

select is((select count(*)::integer from public.email_deliveries
  where idempotency_key = 'refund_confirmation:re_out_1'), 1,
  'multiple events for one Refund create exactly ONE delivery');

select * from finish();

rollback;
