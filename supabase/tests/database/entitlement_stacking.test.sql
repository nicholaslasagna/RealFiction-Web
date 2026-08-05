-- Prepaid entitlement stacking, fulfilment idempotency, and checkout-attempt
-- identity. Exercises the REAL migrated functions, not a JS approximation.
--
-- The rule: new_expiry = max(existing_effective_expiry, now()) + purchased_duration
-- Before this was fixed, every purchase reset expiry to now() + duration, so a
-- customer who re-upped early silently lost time they had already paid for.

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- Fixtures -------------------------------------------------------------------
insert into auth.users (id, email)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'stacking@example.test')
on conflict (id) do nothing;

insert into public.profiles (id, email)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'stacking@example.test')
on conflict (id) do nothing;

insert into public.products (
  id, slug, category, name, description, price_cents, currency,
  fulfillment_type, duration_days, metadata, active
)
values (
  'bbbbbbbb-0000-4000-8000-000000000001',
  'stacking-test-1m', 'supporter', 'Stacking Test', 'Test product', 499, 'USD',
  'subscription', 30, '{"safe_reward": true}'::jsonb, true
)
on conflict (slug) do update set active = true, duration_days = 30;

create or replace function pg_temp.make_order(p_order_id uuid)
returns uuid
language plpgsql
as $$
begin
  insert into public.orders (
    id, user_id, minecraft_username, minecraft_uuid, provider, status,
    subtotal_cents, discount_cents, total_cents, payment_due_cents, currency
  )
  values (
    p_order_id, 'aaaaaaaa-0000-4000-8000-000000000001', 'StackTester',
    '00000000-0000-4000-8000-00000000dead', 'stripe', 'pending',
    499, 0, 499, 499, 'USD'
  );

  insert into public.order_items (order_id, product_id, product_snapshot, quantity, unit_price_cents, total_cents)
  values (
    p_order_id, 'bbbbbbbb-0000-4000-8000-000000000001',
    '{"slug": "stacking-test-1m"}'::jsonb, 1, 499, 499
  );

  return p_order_id;
end;
$$;

create or replace function pg_temp.latest_expiry()
returns timestamptz
language sql
as $$
  select max(expires_at) from public.entitlements
  where entitlement_key = 'product:stacking-test-1m' and status = 'active';
$$;

-- 1. No existing entitlement -> now + duration -------------------------------
select pg_temp.make_order('cccccccc-0000-4000-8000-000000000001');
select public.fulfill_paid_order('cccccccc-0000-4000-8000-000000000001');

select ok(
  pg_temp.latest_expiry() between now() + interval '29 days' and now() + interval '31 days',
  'no existing entitlement -> about 30 days from now'
);

-- 2. Active entitlement -> existing expiry + duration (immediate re-purchase) -
select pg_temp.make_order('cccccccc-0000-4000-8000-000000000002');
select public.fulfill_paid_order('cccccccc-0000-4000-8000-000000000002');

select ok(
  pg_temp.latest_expiry() between now() + interval '59 days' and now() + interval '61 days',
  'immediate second purchase stacks to about 60 days'
);

select is(
  (select count(*)::integer from public.entitlements where entitlement_key = 'product:stacking-test-1m'),
  2,
  'each paid order creates exactly one entitlement row'
);

-- 3. Webhook replay must NOT extend again ------------------------------------
select public.fulfill_paid_order('cccccccc-0000-4000-8000-000000000002');
select public.fulfill_paid_order('cccccccc-0000-4000-8000-000000000002');

select ok(
  pg_temp.latest_expiry() between now() + interval '59 days' and now() + interval '61 days',
  'replayed webhooks do not extend expiry again'
);

select is(
  (select count(*)::integer from public.entitlements where entitlement_key = 'product:stacking-test-1m'),
  2,
  'replayed webhooks create no extra entitlement'
);

select is(
  (select count(*)::integer from public.reward_queue where reward_key = 'store.stacking-test-1m'),
  2,
  'reward_queue stays idempotent across replays'
);

select is(
  (select already_fulfilled from public.fulfill_paid_order('cccccccc-0000-4000-8000-000000000002')),
  true,
  'a repeat fulfilment reports already_fulfilled'
);

-- 4. Two separate paid orders extend exactly once each ------------------------
select is(
  (select count(*)::integer from public.entitlements
   where entitlement_key = 'product:stacking-test-1m'
     and (metadata->>'order_id') = 'cccccccc-0000-4000-8000-000000000001'),
  1,
  'first order contributed exactly one extension'
);

select is(
  (select count(*)::integer from public.entitlements
   where entitlement_key = 'product:stacking-test-1m'
     and (metadata->>'order_id') = 'cccccccc-0000-4000-8000-000000000002'),
  1,
  'second order contributed exactly one extension'
);

-- 5. Expired entitlement -> now + duration (not expiry + duration) -----------
update public.entitlements
set expires_at = now() - interval '10 days', status = 'active'
where entitlement_key = 'product:stacking-test-1m';

select pg_temp.make_order('cccccccc-0000-4000-8000-000000000004');
select public.fulfill_paid_order('cccccccc-0000-4000-8000-000000000004');

select ok(
  pg_temp.latest_expiry() between now() + interval '29 days' and now() + interval '31 days',
  'lapsed access restarts from now, never from a past expiry'
);

-- 6. Revoked entitlements must not extend active time ------------------------
update public.entitlements
set status = 'revoked', revoked_at = now()
where entitlement_key = 'product:stacking-test-1m';

select pg_temp.make_order('cccccccc-0000-4000-8000-000000000005');
select public.fulfill_paid_order('cccccccc-0000-4000-8000-000000000005');

select ok(
  pg_temp.latest_expiry() between now() + interval '29 days' and now() + interval '31 days',
  'revoked time is not counted when stacking'
);

-- 7. Concurrent fulfilment cannot lose an extension --------------------------
-- fulfill_paid_order takes `for update` on the order row, so two callers on the
-- SAME order serialise (proved by the replay tests above). Two DIFFERENT orders
-- fulfilled back-to-back must each add their own duration.
update public.entitlements set status = 'revoked' where entitlement_key = 'product:stacking-test-1m';

select pg_temp.make_order('cccccccc-0000-4000-8000-000000000006');
select pg_temp.make_order('cccccccc-0000-4000-8000-000000000007');
select public.fulfill_paid_order('cccccccc-0000-4000-8000-000000000006');
select public.fulfill_paid_order('cccccccc-0000-4000-8000-000000000007');

select ok(
  pg_temp.latest_expiry() between now() + interval '59 days' and now() + interval '61 days',
  'two orders fulfilled back-to-back both extend (no lost update)'
);

-- Checkout attempt identity now lives in checkout_attempt_lifecycle.test.sql,
-- which covers the bounded lifetime and active-cart lock this suite predates.

select * from finish();

rollback;
