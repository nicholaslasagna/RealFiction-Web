-- Stripe was paid. The webhook never arrived. Reconciliation must FULFIL.
--
-- Holding the upgrade credit while waiting for a webhook that is never coming
-- protects our accounting and abandons the customer: they paid $17.00, hold no
-- rank, and got no email. This suite proves the recovery happens, happens
-- exactly once, and cannot be made to happen twice by any later arrival.

begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

update public.products set active = true
where slug in ('realvip-permanent','real-supporter-permanent');

insert into auth.users (id,email) values
  ('e1000000-0000-4000-8000-000000000001','r1@e.test'),
  ('e1000000-0000-4000-8000-000000000002','r2@e.test'),
  ('e1000000-0000-4000-8000-000000000003','r3@e.test'),
  ('e1000000-0000-4000-8000-000000000004','r4@e.test'),
  ('e1000000-0000-4000-8000-000000000005','r5@e.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like 'e1000000%' on conflict do nothing;

-- A settled, externally paid RealVIP purchase: the upgrade source.
create or replace function pg_temp.src(p_order uuid, p_user uuid) returns void language plpgsql as $$
declare v_pid uuid;
begin
  select id into v_pid from public.products where slug='realvip-permanent';
  insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
    subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
  values (p_order,p_user,'r@e.test','T','stripe','pending',1299,0,1299,0,1299,'USD');
  insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
  values (p_order,v_pid,'{"slug":"realvip-permanent"}'::jsonb,1,1299,1299);
  perform public.fulfill_paid_order(p_order);
end; $$;

-- The upgrade order: 3499 - 1299 = 2200, of which 500 is store credit and
-- 1700 is the Stripe charge. Session persisted; order still pending.
create or replace function pg_temp.upg(p_order uuid, p_user uuid, p_session text) returns void language plpgsql as $$
declare v_pid uuid;
begin
  select id into v_pid from public.products where slug='real-supporter-permanent';
  insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
    subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
  values (p_order,p_user,'r@e.test','T','stripe','pending',3499,1299,2200,500,1700,'USD');
  insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
  values (p_order,v_pid,'{"slug":"real-supporter-permanent"}'::jsonb,1,3499,3499);
  insert into public.checkout_attempts (user_id,attempt_id,cart_fingerprint,order_id,
    stripe_session_id,stripe_session_expires_at)
  values (p_user,gen_random_uuid(),'c-'||p_order::text,p_order,p_session,now() + interval '30 minutes');
  -- Fund and reserve the store credit the customer is spending.
  insert into public.store_credit_ledger (user_id,delta_cents,source,source_ref,idempotency_key,note)
  values (p_user,500,'manual_grant','seed','seed:'||p_order::text,'seed');
  perform public.reserve_store_credit_for_order(p_order,p_user,500);
  perform public.reserve_upgrade_credit(p_user,'real-supporter-permanent',p_order,gen_random_uuid());
end; $$;

create or replace function pg_temp.st(p_order uuid) returns text language sql as $$
  select state from public.upgrade_credit_reservations where order_id = p_order;
$$;

create or replace function pg_temp.ents(p_order uuid) returns bigint language sql as $$
  select count(*) from public.entitlements e
  join public.order_items oi on oi.id = e.order_item_id
  where oi.order_id = p_order and e.status = 'active';
$$;

create or replace function pg_temp.mails(p_order uuid) returns bigint language sql as $$
  select count(*) from public.email_deliveries where order_id = p_order;
$$;

create or replace function pg_temp.rewards(p_order uuid) returns bigint language sql as $$
  select count(*) from public.reward_queue rq
  join public.order_items oi on oi.id = rq.source_id
  where oi.order_id = p_order;
$$;

-- The credit spend for this order, in the ledger.
create or replace function pg_temp.spend(p_order uuid) returns bigint language sql as $$
  select coalesce(sum(delta_cents),0) from public.store_credit_ledger
  where source_ref = p_order::text and source in ('store_purchase_spend','store_credit_reserve');
$$;

-- ===========================================================================
-- 1. THE RECOVERY: Stripe paid, webhook lost, reconciliation fulfils
-- ===========================================================================
select pg_temp.src('e1100000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001');
select pg_temp.upg('e1200000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','cs_lost');

-- Where we start: money taken by Stripe, nothing delivered here.
select is((select status::text from public.orders where id='e1200000-0000-4000-8000-000000000001'),
  'pending', 'the order is stuck pending — the success webhook never arrived');
select is(pg_temp.ents('e1200000-0000-4000-8000-000000000001'), 0::bigint,
  'the customer holds no rank for the money they paid');
select is(pg_temp.mails('e1200000-0000-4000-8000-000000000001'), 0::bigint,
  'and no confirmation email was ever queued');

-- Age the hold so it becomes due, then claim it exactly as the Worker does.
update public.upgrade_credit_reservations set expires_at = now() - interval '1 minute'
where order_id='e1200000-0000-4000-8000-000000000001';

select is((select count(*)::integer from public.claim_upgrade_reconciliations('worker-a',10,120)
  where order_id='e1200000-0000-4000-8000-000000000001'), 1,
  'the stuck reservation is claimed for reconciliation');

select is((select expected_amount_cents from public.claim_upgrade_reconciliations('worker-a',10,120)
  where order_id='e1200000-0000-4000-8000-000000000001'), null::bigint,
  'and a second claim in the same lease returns nothing');

-- Stripe says paid. The application now runs the SAME fulfilment transaction the
-- webhook would have run.
select public.fulfill_paid_order_with_outbox('e1200000-0000-4000-8000-000000000001','pi_lost','ch_lost',null);

select is((select status::text from public.orders where id='e1200000-0000-4000-8000-000000000001'),
  'fulfilled', 'RECONCILIATION ITSELF FULFILLED THE ORDER');
select is(pg_temp.st('e1200000-0000-4000-8000-000000000001'), 'consumed',
  'the upgrade credit is consumed exactly once');
select ok(pg_temp.ents('e1200000-0000-4000-8000-000000000001') > 0,
  'the rank the customer paid for is granted');
select is(pg_temp.mails('e1200000-0000-4000-8000-000000000001'), 1::bigint,
  'exactly one confirmation email is queued');
select ok(pg_temp.rewards('e1200000-0000-4000-8000-000000000001') > 0,
  'the in-game delivery is queued');
select ok((select paid_at from public.orders where id='e1200000-0000-4000-8000-000000000001') is not null,
  'the payment reference is recorded');

-- RealSupporter includes RealVIP: the included grant happens in the same
-- transaction, not as a follow-up job.
select ok(exists(select 1 from public.entitlements
  where user_id='e1000000-0000-4000-8000-000000000001'
    and entitlement_key='product:realvip-permanent'
    and status='active'),
  'the included RealVIP entitlement is granted too');

-- The reconciliation verdict is recorded, and finds nothing left to do.
select is((select outcome from public.apply_upgrade_reconciliation(
  (select id from public.upgrade_credit_reservations where order_id='e1200000-0000-4000-8000-000000000001'),
  'paid','cs_lost')), 'already_consumed',
  'applying the paid verdict afterwards is an idempotent no-op');

-- ===========================================================================
-- 2. The late webhook is a harmless replay
-- ===========================================================================
select public.fulfill_paid_order_with_outbox('e1200000-0000-4000-8000-000000000001','pi_lost','ch_lost',null);

select is(pg_temp.st('e1200000-0000-4000-8000-000000000001'), 'consumed',
  'a webhook arriving later consumes nothing extra');
select is(pg_temp.mails('e1200000-0000-4000-8000-000000000001'), 1::bigint,
  'and queues no second email');
select is((select count(*)::integer from public.entitlements e
  join public.order_items oi on oi.id = e.order_item_id
  where oi.order_id='e1200000-0000-4000-8000-000000000001'
    and e.entitlement_key='product:real-supporter-permanent'), 1,
  'and grants no second entitlement');

-- ===========================================================================
-- 3. Reconciliation racing an EXPIRY webhook cannot undo a paid order
-- ===========================================================================
select ok(not public.mark_order_unpaid_closed('e1200000-0000-4000-8000-000000000001','session_expired'),
  'an expiry webhook cannot cancel an order that is already fulfilled');
select is((select status::text from public.orders where id='e1200000-0000-4000-8000-000000000001'),
  'fulfilled', 'the fulfilled order stands');

-- ===========================================================================
-- 4. Two workers cannot both claim the same row
-- ===========================================================================
select pg_temp.src('e1100000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002');
select pg_temp.upg('e1200000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002','cs_two');
update public.upgrade_credit_reservations set expires_at = now() - interval '1 minute'
where order_id='e1200000-0000-4000-8000-000000000002';

select is((select count(*)::integer from public.claim_upgrade_reconciliations('worker-a',10,120)
  where order_id='e1200000-0000-4000-8000-000000000002'), 1, 'worker A claims the row');
select is((select count(*)::integer from public.claim_upgrade_reconciliations('worker-b',10,120)
  where order_id='e1200000-0000-4000-8000-000000000002'), 0,
  'worker B is refused while the lease is live');
select is((select reconciliation_worker from public.upgrade_credit_reservations
  where order_id='e1200000-0000-4000-8000-000000000002'), 'worker-a',
  'the lease names its holder');

-- A crashed worker costs nothing: the lease expires and the row returns.
update public.upgrade_credit_reservations set reconciliation_lease_until = now() - interval '1 second'
where order_id='e1200000-0000-4000-8000-000000000002';
select is((select count(*)::integer from public.claim_upgrade_reconciliations('worker-b',10,120)
  where order_id='e1200000-0000-4000-8000-000000000002'), 1,
  'after the lease expires the row is claimable again');
select is(pg_temp.st('e1200000-0000-4000-8000-000000000002'), 'reserved',
  'and a crashed worker released NOTHING by crashing');

-- ===========================================================================
-- 5. The review sweep must not touch a row under active reconciliation
-- ===========================================================================
select pg_temp.src('e1100000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000003');
select pg_temp.upg('e1200000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000003','cs_swept');

-- Old enough for the 72-hour review sweep, but currently claimed.
update public.upgrade_credit_reservations
set expires_at = now() - interval '80 hours',
    reconciliation_lease_until = now() + interval '2 minutes',
    reconciliation_worker = 'worker-live'
where order_id='e1200000-0000-4000-8000-000000000003';

select is(public.expire_stale_upgrade_reservations(), 0,
  'the sweep skips a leased row entirely');
select is(pg_temp.st('e1200000-0000-4000-8000-000000000003'), 'reserved',
  'the claimed reservation is untouched mid-flight');

-- Once the lease lapses the sweep may escalate it — to REVIEW, never release.
update public.upgrade_credit_reservations set reconciliation_lease_until = null
where order_id='e1200000-0000-4000-8000-000000000003';
select ok(public.expire_stale_upgrade_reservations() > 0, 'an unleased stale row is swept');
select is(pg_temp.st('e1200000-0000-4000-8000-000000000003'), 'needs_review',
  'a session-backed unresolved hold goes to a human, never to released');

-- ===========================================================================
-- 6. Backoff and the attempt ceiling
-- ===========================================================================
select pg_temp.src('e1100000-0000-4000-8000-000000000004','e1000000-0000-4000-8000-000000000004');
select pg_temp.upg('e1200000-0000-4000-8000-000000000004','e1000000-0000-4000-8000-000000000004','cs_flaky');
update public.upgrade_credit_reservations set expires_at = now() - interval '1 minute'
where order_id='e1200000-0000-4000-8000-000000000004';

select public.claim_upgrade_reconciliations('worker-a',10,120);
select is((select outcome from public.finish_upgrade_reconciliation(
  (select id from public.upgrade_credit_reservations where order_id='e1200000-0000-4000-8000-000000000004'),
  'provider_unreachable', true, 10)), 'retry_scheduled',
  'an unreachable provider schedules a retry');
select ok((select next_reconciliation_at from public.upgrade_credit_reservations
  where order_id='e1200000-0000-4000-8000-000000000004') > now(),
  'with backoff, so a five-minute tick does not hammer Stripe');
select is((select count(*)::integer from public.claim_upgrade_reconciliations('worker-a',10,120)
  where order_id='e1200000-0000-4000-8000-000000000004'), 0,
  'and the row is not re-claimed before its backoff elapses');

update public.upgrade_credit_reservations
set reconciliation_attempts = 10, next_reconciliation_at = null
where order_id='e1200000-0000-4000-8000-000000000004';
select is((select outcome from public.finish_upgrade_reconciliation(
  (select id from public.upgrade_credit_reservations where order_id='e1200000-0000-4000-8000-000000000004'),
  'provider_unreachable', true, 10)), 'escalated_to_review',
  'after the attempt ceiling a HUMAN is asked');
select is(pg_temp.st('e1200000-0000-4000-8000-000000000004'), 'needs_review',
  'never released on exhaustion');

-- ===========================================================================
-- 7. A mismatch parks the row and releases nothing
-- ===========================================================================
select pg_temp.src('e1100000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000005');
select pg_temp.upg('e1200000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000005','cs_wrong');

select is((select outcome from public.apply_upgrade_reconciliation(
  (select id from public.upgrade_credit_reservations where order_id='e1200000-0000-4000-8000-000000000005'),
  'mismatch','cs_wrong')), 'needs_review_mismatch',
  'a contradiction between Stripe and our order goes to review');
select is(pg_temp.st('e1200000-0000-4000-8000-000000000005'), 'needs_review',
  'the reservation is retained, not released');
select is((select status::text from public.orders where id='e1200000-0000-4000-8000-000000000005'),
  'pending', 'and the order is not cancelled on a mismatch');
select ok(exists(select 1 from public.payment_reviews
  where reason='provider_record_contradicts_order'
    and order_id='e1200000-0000-4000-8000-000000000005'
    and detail->>'priority'='high'),
  'a high-priority review names the order');

select * from finish();
rollback;
