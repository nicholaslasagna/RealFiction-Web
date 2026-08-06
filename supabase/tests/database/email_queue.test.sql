-- Email queue + provider-idempotency lifecycle.
--
-- Resend honours an Idempotency-Key for ~24h. Duplicate suppression is therefore
-- BOUNDED, not global exactly-once: inside a 23h window the same key is replayed
-- safely; outside it, an unresolved delivery escalates to delivery_uncertain
-- rather than risking a second send with a fresh key.

begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

insert into auth.users (id, email) values ('beef0000-0000-4000-8000-000000000001', 'q@example.test')
on conflict (id) do nothing;
insert into public.profiles (id, email) values ('beef0000-0000-4000-8000-000000000001', 'q@example.test')
on conflict (id) do nothing;
insert into public.orders (
  id, user_id, buyer_email, minecraft_username, provider, status,
  subtotal_cents, discount_cents, total_cents, payment_due_cents, currency
) values (
  'feed0000-0000-4000-8000-000000000001', 'beef0000-0000-4000-8000-000000000001',
  'q@example.test', 'QueueTester', 'stripe', 'fulfilled', 1299, 0, 1299, 1299, 'USD'
);

create or replace function pg_temp.outcome(p_key text) returns text language sql as $$
  select delivery_outcome from public.email_deliveries where idempotency_key = p_key;
$$;
create or replace function pg_temp.did(p_key text) returns uuid language sql as $$
  select id from public.email_deliveries where idempotency_key = p_key;
$$;

-- 1. Enqueue is idempotent; the webhook sends nothing ------------------------
select is((select created from public.enqueue_email_delivery(
  'order_confirmation:feed0000-0000-4000-8000-000000000001',
  'order_confirmation', 'q@example.test', 'feed0000-0000-4000-8000-000000000001', '{}'::jsonb)),
  true, 'the first enqueue creates a delivery');

select is((select created from public.enqueue_email_delivery(
  'order_confirmation:feed0000-0000-4000-8000-000000000001',
  'order_confirmation', 'q@example.test', 'feed0000-0000-4000-8000-000000000001', '{}'::jsonb)),
  false, 'a replayed webhook creates no second delivery');

select is(pg_temp.outcome('order_confirmation:feed0000-0000-4000-8000-000000000001'), 'pending',
  'enqueue leaves it pending — no provider contact from the webhook');

select ok(
  (select first_provider_attempt_at from public.email_deliveries
   where idempotency_key = 'order_confirmation:feed0000-0000-4000-8000-000000000001') is null,
  'enqueue opens no provider-idempotency window');

-- 2. Leasing and concurrency --------------------------------------------------
select is((select count(*)::integer from public.claim_due_email_deliveries(10, 120, 'w-a')), 1,
  'a due delivery is claimed');
select is(pg_temp.outcome('order_confirmation:feed0000-0000-4000-8000-000000000001'), 'processing',
  'the claimed row is processing');
select is((select count(*)::integer from public.claim_due_email_deliveries(10, 120, 'w-b')), 0,
  'a leased row is invisible to a second processor');

update public.email_deliveries set locked_until = now() - interval '1 minute'
where idempotency_key = 'order_confirmation:feed0000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.claim_due_email_deliveries(10, 120, 'w-c')), 1,
  'an abandoned lease is recovered');

-- 3. The provider window opens on first dispatch ------------------------------
select ok(
  public.begin_email_provider_attempt(
    pg_temp.did('order_confirmation:feed0000-0000-4000-8000-000000000001'))
    between now() + interval '22 hours' and now() + interval '23 hours',
  'the first dispatch opens a ~23h window (inside Resend''s 24h retention)');

select ok(
  (select provider_idempotency_expires_at from public.email_deliveries
   where idempotency_key = 'order_confirmation:feed0000-0000-4000-8000-000000000001')
  = (select public.begin_email_provider_attempt(
       pg_temp.did('order_confirmation:feed0000-0000-4000-8000-000000000001'))),
  'a later attempt does NOT move the deadline');

-- 4. Sent is terminal ---------------------------------------------------------
select public.mark_email_sent(
  pg_temp.did('order_confirmation:feed0000-0000-4000-8000-000000000001'), 'resend-1', 200);
select is((select count(*)::integer from public.claim_due_email_deliveries(10, 120, 'w-d')), 0,
  'a SENT delivery can never be reclaimed');
select is((select provider_message_id from public.email_deliveries
  where idempotency_key = 'order_confirmation:feed0000-0000-4000-8000-000000000001'), 'resend-1',
  'the provider message id is persisted');

-- 5. Retry inside the window --------------------------------------------------
select public.enqueue_email_delivery('k-retry', 'order_confirmation', 'q@example.test', null, '{}'::jsonb);
select public.claim_due_email_deliveries(10, 120, 'w');
select public.begin_email_provider_attempt(pg_temp.did('k-retry'));
select public.mark_email_failed(pg_temp.did('k-retry'), 'resend_503', true, 503, 'provider_error', null);

select is(pg_temp.outcome('k-retry'), 'failed_retryable', 'a 5xx inside the window stays retryable');
select is((select count(*)::integer from public.claim_due_email_deliveries(10, 120, 'w')), 0,
  'a backing-off delivery is not claimed early');

update public.email_deliveries set next_attempt_at = now() - interval '1 second' where idempotency_key = 'k-retry';
select is((select count(*)::integer from public.claim_due_email_deliveries(10, 120, 'w')), 1,
  'once the backoff elapses it is claimed again, reusing the same key');

-- 6. THE deadline: a retry that would land outside the window escalates -------
select public.enqueue_email_delivery('k-deadline', 'order_confirmation', 'q@example.test', null, '{}'::jsonb);
select public.claim_due_email_deliveries(10, 120, 'w');
select public.begin_email_provider_attempt(pg_temp.did('k-deadline'));
-- Simulate: the window is nearly closed.
update public.email_deliveries
set provider_idempotency_expires_at = now() + interval '5 seconds'
where idempotency_key = 'k-deadline';
select public.mark_email_failed(pg_temp.did('k-deadline'), 'resend_503', true, 503, 'provider_error', null);

select is(pg_temp.outcome('k-deadline'), 'delivery_uncertain',
  'a retry that would land past the deadline escalates instead of risking a duplicate');
select ok((select next_attempt_at from public.email_deliveries where idempotency_key = 'k-deadline') is null,
  'no further automatic attempt is scheduled');
select is((select count(*)::integer from public.claim_due_email_deliveries(10, 120, 'w')
          where idempotency_key = 'k-deadline'), 0,
  'a delivery_uncertain row calls the provider ZERO more times');

-- 7. An expired window sweeps unresolved rows to delivery_uncertain -----------
select public.enqueue_email_delivery('k-expired', 'order_confirmation', 'q@example.test', null, '{}'::jsonb);
select public.claim_due_email_deliveries(10, 120, 'w');
select public.begin_email_provider_attempt(pg_temp.did('k-expired'));
update public.email_deliveries
set provider_idempotency_expires_at = now() - interval '1 hour', locked_until = now() - interval '1 hour'
where idempotency_key = 'k-expired';

select ok(public.expire_email_idempotency_windows() >= 1, 'the sweep retires stale windows');
select is(pg_temp.outcome('k-expired'), 'delivery_uncertain',
  'a DB outage longer than the window makes the delivery uncertain, not resent');
select is((select count(*)::integer from public.claim_due_email_deliveries(10, 120, 'w')
          where idempotency_key = 'k-expired'), 0,
  'zero automatic sends after the window closes');

-- 8. Permanent failures are never retried ------------------------------------
select public.enqueue_email_delivery('k-perm', 'order_confirmation', 'bad', null, '{}'::jsonb);
select public.claim_due_email_deliveries(10, 120, 'w');
select public.mark_email_failed(pg_temp.did('k-perm'), 'resend_422', false, 422, 'payload_rejected', null);

select is(pg_temp.outcome('k-perm'), 'failed_permanent', 'an ordinary 4xx is permanent');
select is((select count(*)::integer from public.claim_due_email_deliveries(10, 120, 'w')
          where idempotency_key = 'k-perm'), 0,
  'a permanent failure is NEVER automatically retried');

-- 9. Missing configuration stays recoverable for days ------------------------
select public.enqueue_email_delivery('k-unconf', 'order_confirmation', 'q@example.test', null, '{}'::jsonb);
select public.claim_due_email_deliveries(10, 120, 'w');
select public.mark_email_unconfigured(pg_temp.did('k-unconf'), 300);

select is((select attempts from public.email_deliveries where idempotency_key = 'k-unconf'), 0,
  'a missing binding does not consume the attempt budget');

-- Days later, still no provider window and still claimable.
update public.email_deliveries
set next_attempt_at = now() - interval '3 days', created_at = now() - interval '3 days'
where idempotency_key = 'k-unconf';

select is((select count(*)::integer from public.claim_due_email_deliveries(10, 120, 'w')
          where idempotency_key = 'k-unconf'), 1,
  'after several days unconfigured, it still sends once the binding is added');

-- 10. Manual resend is a NEW audited identity --------------------------------
select is(
  (select new_idempotency_key from public.request_email_resend(pg_temp.did('k-expired'), 'admin@realfiction.live')),
  'k-expired:resend:1',
  'a manual resend mints a NEW operation identity derived from the root key');

select is(
  (select count(*)::integer from public.email_deliveries where resend_of = pg_temp.did('k-expired')),
  1, 'the resend is a separate delivery row');

select is(pg_temp.outcome('k-expired'), 'delivery_uncertain',
  'the original delivery record is preserved for audit, never mutated');

select is(
  (select new_idempotency_key from public.request_email_resend(
    pg_temp.did('k-expired:resend:1'), 'admin@realfiction.live')),
  'k-expired:resend:2',
  'resending a resend increments rather than compounding the suffix');

select * from finish();

rollback;
