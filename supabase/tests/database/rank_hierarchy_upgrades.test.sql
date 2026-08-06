-- Permanent ranks, rank inclusion, upgrade pricing, and legacy compatibility.

begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id,email) values ('a1000000-0000-4000-8000-000000000001','rank@example.test') on conflict do nothing;
insert into public.profiles (id,email) values ('a1000000-0000-4000-8000-000000000001','rank@example.test') on conflict do nothing;

create or replace function pg_temp.buy(p_order uuid, p_slug text, p_status text default 'pending')
returns uuid language plpgsql as $$
declare v_pid uuid; v_price bigint;
begin
  select id, price_cents into v_pid, v_price from public.products where slug = p_slug;
  insert into public.orders (id,user_id,buyer_email,minecraft_username,minecraft_uuid,provider,status,
    subtotal_cents,discount_cents,total_cents,payment_due_cents,currency)
  values (p_order,'a1000000-0000-4000-8000-000000000001','rank@example.test','RankTester',
    '00000000-0000-4000-8000-00000000ra11','stripe',p_status::public.order_status,
    v_price,0,v_price,v_price,'USD');
  insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
  values (p_order,v_pid,jsonb_build_object('slug',p_slug),1,v_price,v_price);
  return p_order;
end; $$;

create or replace function pg_temp.owns(p_slug text) returns boolean language sql as $$
  select exists(select 1 from public.entitlements
    where user_id='a1000000-0000-4000-8000-000000000001'
      and entitlement_key='product:'||p_slug and status='active');
$$;

-- 1. Catalog shape -----------------------------------------------------------
select is((select fulfillment_type::text from public.products where slug='realvip-permanent'),
  'permanent', 'RealVIP is a permanent product');
select ok((select duration_days from public.products where slug='realvip-permanent') is null,
  'a permanent rank has no duration');
select is((select fulfillment_type::text from public.products where slug='realfiction-plus-30d'),
  'subscription', 'RealFiction+ is a fixed-term product');
select is((select active from public.products where slug='realfiction-plus-30d'), false,
  'RealFiction+ is NOT purchasable: none of its advertised benefits exist yet');
select is((select duration_days from public.products where slug='realfiction-plus-30d'), 30,
  'RealFiction+ runs 30 days');

-- 2. LEGACY COMPATIBILITY ----------------------------------------------------
-- EXPAND-AND-CONTRACT: the additive migration must NOT deactivate legacy SKUs
-- while the old application is still deployed and selling them.
select ok((select count(*) from public.products where slug ~ '-(1m|3m|6m|12m)$' and slug !~ '^gift-card' and active) > 0,
  'legacy term SKUs stay purchasable during the additive stage (no deploy-order outage)');
select ok((select count(*) from public.products where slug='realvip-12m') = 1,
  'legacy SKU ROWS are preserved so historical orders still join');

-- A legacy customer with an active term keeps it, untouched.
insert into public.entitlements (user_id,minecraft_uuid,minecraft_username,entitlement_key,status,starts_at,expires_at,metadata)
values ('a1000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-00000000ra11','RankTester',
  'product:realvip-12m','active',now(),now()+interval '200 days','{"source":"legacy"}'::jsonb);
select ok(pg_temp.owns('realvip-12m'), 'a legacy term entitlement survives the migration');
select ok((select expires_at from public.entitlements where entitlement_key='product:realvip-12m')
  > now() + interval '199 days', 'its paid-for expiry is unchanged');

-- 3. Permanent purchase grants a never-expiring entitlement -------------------
select pg_temp.buy('b1000000-0000-4000-8000-000000000001','realvip-permanent');
select public.fulfill_paid_order('b1000000-0000-4000-8000-000000000001');
select ok(pg_temp.owns('realvip-permanent'), 'buying RealVIP grants it');
select ok((select expires_at from public.entitlements where entitlement_key='product:realvip-permanent') is null,
  'a permanent rank never expires');

-- 4. Upgrade pricing ---------------------------------------------------------
select is((select eligible from public.compute_upgrade_price(
  'a1000000-0000-4000-8000-000000000001','real-supporter-permanent')), true,
  'a RealVIP owner is upgrade-eligible');
select is((select upgrade_price_cents from public.compute_upgrade_price(
  'a1000000-0000-4000-8000-000000000001','real-supporter-permanent')), 3499::bigint - 1299,
  'upgrade price = target minus what was actually paid');

-- 5. Credit consumption now lives in the RESERVATION lifecycle ---------------
-- See upgrade_credit_lifecycle.test.sql: reserve at checkout, consume only
-- inside successful fulfilment, release on every failure path.
select pg_temp.buy('b1000000-0000-4000-8000-000000000002','real-supporter-permanent');

-- 6. RANK INCLUSION ----------------------------------------------------------
select public.fulfill_paid_order('b1000000-0000-4000-8000-000000000002');
select ok(pg_temp.owns('real-supporter-permanent'), 'RealSupporter is granted');
select ok(pg_temp.owns('realvip-permanent'), 'and it INCLUDES RealVIP');

-- Already owning the target blocks a second purchase-as-upgrade.
select is((select reason from public.compute_upgrade_price(
  'a1000000-0000-4000-8000-000000000001','real-supporter-permanent')), 'upgrade_target_already_owned',
  'an owner cannot upgrade to what they already own');

-- 7. Bundle inclusion is transitive-safe and idempotent ----------------------
select pg_temp.buy('b1000000-0000-4000-8000-000000000003','cosmetic-atelier-permanent');
select public.fulfill_paid_order('b1000000-0000-4000-8000-000000000003');
select ok(pg_temp.owns('username-colors-permanent'), 'the bundle grants its colours');
select ok(pg_temp.owns('realpets-permanent'), 'the bundle grants its pets');

select public.fulfill_paid_order('b1000000-0000-4000-8000-000000000003');
select is((select count(*)::integer from public.entitlements
  where user_id='a1000000-0000-4000-8000-000000000001'
    and entitlement_key='product:username-colors-permanent'), 1,
  'a replayed webhook grants no duplicate included entitlement');

-- 8. A refunded source grants no upgrade credit ------------------------------
insert into auth.users (id,email) values ('a1000000-0000-4000-8000-000000000002','r2@example.test') on conflict do nothing;
insert into public.profiles (id,email) values ('a1000000-0000-4000-8000-000000000002','r2@example.test') on conflict do nothing;
insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
  subtotal_cents,discount_cents,total_cents,payment_due_cents,currency)
values ('b1000000-0000-4000-8000-000000000009','a1000000-0000-4000-8000-000000000002','r2@example.test',
  'R2','stripe','refunded',1299,0,1299,1299,'USD');
insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
select 'b1000000-0000-4000-8000-000000000009', id, '{"slug":"realvip-permanent"}'::jsonb,1,1299,1299
from public.products where slug='realvip-permanent';

select is((select reason from public.compute_upgrade_price(
  'a1000000-0000-4000-8000-000000000002','real-supporter-permanent')), 'upgrade_credit_unavailable',
  'a REFUNDED purchase grants no upgrade credit');

-- 9. Upgrade price can never go negative -------------------------------------
select ok((select upgrade_price_cents from public.compute_upgrade_price(
  'a1000000-0000-4000-8000-000000000002','real-supporter-permanent')) >= 0,
  'upgrade price is never negative');

select * from finish();
rollback;
