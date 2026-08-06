-- What happens when one of the two orders in an upgrade is reversed.
--
-- An upgrade binds two purchases together. Refunding either one asks a question
-- the other cannot answer alone:
--
--   * Refund the SOURCE RealVIP after its credit was spent, and a discounted
--     RealSupporter is left standing on nothing. Buy VIP, upgrade cheaply,
--     refund VIP, keep the rank.
--   * Refund the UPGRADED RealSupporter, and the customer should get their
--     upgrade eligibility back — but only if the money really went back, and
--     only if the source purchase is still valid.
--
-- Neither is auto-resolved by arithmetic. Both are proven here to reach a safe,
-- auditable, retryable state.

begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

update public.products set active = true
where slug in ('realvip-permanent','real-supporter-permanent');

insert into auth.users (id,email) values
  ('a1000000-0000-4000-8000-000000000001','d1@e.test'),
  ('a1000000-0000-4000-8000-000000000002','d2@e.test'),
  ('a1000000-0000-4000-8000-000000000003','d3@e.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like 'a1000000%' on conflict do nothing;

create or replace function pg_temp.src(p_order uuid, p_user uuid) returns void language plpgsql as $$
declare v_pid uuid;
begin
  select id into v_pid from public.products where slug='realvip-permanent';
  insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
    subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
  values (p_order,p_user,'d@e.test','T','stripe','pending',1299,0,1299,0,1299,'USD');
  insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
  values (p_order,v_pid,'{"slug":"realvip-permanent"}'::jsonb,1,1299,1299);
  perform public.fulfill_paid_order(p_order);
end; $$;

-- A COMPLETED upgrade: credit reserved then consumed by fulfilment.
create or replace function pg_temp.upg(p_order uuid, p_user uuid) returns void language plpgsql as $$
declare v_pid uuid;
begin
  select id into v_pid from public.products where slug='real-supporter-permanent';
  insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
    subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
  values (p_order,p_user,'d@e.test','T','stripe','pending',3499,1299,2200,0,2200,'USD');
  insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
  values (p_order,v_pid,'{"slug":"real-supporter-permanent"}'::jsonb,1,3499,3499);
  perform public.reserve_upgrade_credit(p_user,'real-supporter-permanent',p_order,gen_random_uuid());
  perform public.fulfill_paid_order_with_outbox(p_order,'pi_'||left(p_order::text,8),null,null);
end; $$;

create or replace function pg_temp.st(p_order uuid) returns text language sql as $$
  select state from public.upgrade_credit_reservations where order_id = p_order;
$$;

create or replace function pg_temp.owns(p_user uuid, p_slug text) returns boolean language sql as $$
  select exists(select 1 from public.entitlements
    where user_id = p_user and entitlement_key = 'product:'||p_slug and status = 'active');
$$;

-- ===========================================================================
-- PART 1: the SOURCE is refunded after its credit was consumed
-- ===========================================================================
select pg_temp.src('a1100000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001');
select pg_temp.upg('a1200000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001');

select is(pg_temp.st('a1200000-0000-4000-8000-000000000001'), 'consumed',
  'the upgrade credit was consumed by a successful fulfilment');
select is((select has_dependency from public.upgrade_dependency_for_order(
  'a1100000-0000-4000-8000-000000000001')), true,
  'the source order is detectable as an upgrade dependency BEFORE any refund runs');

-- Refund the source. The trigger must flag, not silently proceed.
select public.record_order_refund('a1100000-0000-4000-8000-000000000001','re_src',1299,'USD',true);
update public.orders set status='refunded' where id='a1100000-0000-4000-8000-000000000001';

select ok(exists(select 1 from public.payment_reviews
  where reason='upgrade_source_refunded_dependency'
    and order_id='a1200000-0000-4000-8000-000000000001'),
  'exactly one review is raised, naming the DEPENDENT order');
select is((select count(*)::integer from public.payment_reviews
  where reason='upgrade_source_refunded_dependency'
    and order_id='a1200000-0000-4000-8000-000000000001'), 1,
  'and repeating the status change does not raise a second');

select is((select detail->>'priority' from public.payment_reviews
  where reason='upgrade_source_refunded_dependency'
    and order_id='a1200000-0000-4000-8000-000000000001'), 'high',
  'it is high priority');
select is((select detail->>'source_order_id' from public.payment_reviews
  where reason='upgrade_source_refunded_dependency'
    and order_id='a1200000-0000-4000-8000-000000000001'),
  'a1100000-0000-4000-8000-000000000001', 'the source ORDER is recorded');
select ok((select detail->>'source_order_item_id' from public.payment_reviews
  where reason='upgrade_source_refunded_dependency'
    and order_id='a1200000-0000-4000-8000-000000000001') is not null,
  'the source ORDER ITEM is recorded — item-level identity, not order-level');
select ok((select detail->>'upgrade_reservation_id' from public.payment_reviews
  where reason='upgrade_source_refunded_dependency'
    and order_id='a1200000-0000-4000-8000-000000000001') is not null,
  'the stable upgrade-credit identity is recorded');
select is((select detail->>'credit_cents' from public.payment_reviews
  where reason='upgrade_source_refunded_dependency'
    and order_id='a1200000-0000-4000-8000-000000000001'), '1299',
  'and the exact credit that was spent');

-- The dependent ENTITLEMENT LINEAGE, including the inherited RealVIP grant.
select ok(jsonb_array_length((select detail->'dependent_entitlements' from public.payment_reviews
  where reason='upgrade_source_refunded_dependency'
    and order_id='a1200000-0000-4000-8000-000000000001')) > 0,
  'the dependent rank entitlements are enumerated');
select ok(exists(select 1 from jsonb_array_elements(
    (select detail->'dependent_entitlements' from public.payment_reviews
     where reason='upgrade_source_refunded_dependency'
       and order_id='a1200000-0000-4000-8000-000000000001')) e
  where e->>'entitlement_key' = 'product:real-supporter-permanent'),
  'including the purchased RealSupporter grant');
select ok(exists(select 1 from jsonb_array_elements(
    (select detail->'dependent_entitlements' from public.payment_reviews
     where reason='upgrade_source_refunded_dependency'
       and order_id='a1200000-0000-4000-8000-000000000001')) e
  where e->>'entitlement_key' = 'product:realvip-permanent'
    and e->>'source' = 'inclusion'),
  'AND the INHERITED RealVIP grant — the easy one to miss');

-- Safety: the credit is not handed back, and the rank is not silently taken.
select is(pg_temp.st('a1200000-0000-4000-8000-000000000001'), 'needs_review',
  'the consumed credit is parked for a human, NOT restored');
select ok(pg_temp.owns('a1000000-0000-4000-8000-000000000001','real-supporter-permanent'),
  'the dependent rank is not auto-revoked — that is an owner decision');

-- And the source can never quietly fund a second upgrade.
select is((select reason from public.compute_upgrade_price(
  'a1000000-0000-4000-8000-000000000001','real-supporter-permanent')),
  'upgrade_target_already_owned', 'the source cannot fund another upgrade');

-- ===========================================================================
-- PART 2: a source CHARGEBACK is the same dependency, higher stakes
-- ===========================================================================
select pg_temp.src('a1100000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002');
select pg_temp.upg('a1200000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002');

update public.orders set status='chargeback' where id='a1100000-0000-4000-8000-000000000002';
select ok(exists(select 1 from public.payment_reviews
  where reason='upgrade_source_chargeback_dependency'
    and order_id='a1200000-0000-4000-8000-000000000002'
    and detail->>'priority'='high'),
  'a source chargeback raises the same high-priority dependency review');
select is(pg_temp.st('a1200000-0000-4000-8000-000000000002'), 'needs_review',
  'and the credit is parked, never restored');

-- ===========================================================================
-- PART 3: the UPGRADED order is fully refunded
-- ===========================================================================
select pg_temp.src('a1100000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000003');
select pg_temp.upg('a1200000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000003');

-- An independently purchased, manually granted, and source RealVIP all exist.
insert into public.entitlements (user_id, entitlement_key, status, metadata)
values ('a1000000-0000-4000-8000-000000000003','product:realpets','active','{"source":"manual_grant"}'::jsonb);

select is(pg_temp.st('a1200000-0000-4000-8000-000000000003'), 'consumed', 'the credit is consumed');

-- 3a. The money goes back first. Restoration is gated on the MEASURED position,
-- so a status flip alone must not restore anything.
select is((select outcome from public.restore_upgrade_credit_after_refund(
  'a1200000-0000-4000-8000-000000000003', false, false)), 'partial_refund_needs_review',
  'a PARTIAL refund never restores upgrade eligibility');
select is(pg_temp.st('a1200000-0000-4000-8000-000000000003'), 'needs_review',
  'it goes to review instead');

-- Reset to consumed to test the full-refund path from the same start.
update public.upgrade_credit_reservations set state='consumed', released_reason=null
where order_id='a1200000-0000-4000-8000-000000000003';

-- 3b. Full money back, but the rank has NOT been revoked yet. That is a timing
-- condition, not an ambiguity — it must stay retryable.
select public.record_order_refund('a1200000-0000-4000-8000-000000000003','re_upg',2200,'USD',true);
select is((select is_full_economic_refund from public.order_refund_state(
  'a1200000-0000-4000-8000-000000000003')), true, 'the full 2200 is economically reversed');

select is((select outcome from public.restore_upgrade_credit_after_refund(
  'a1200000-0000-4000-8000-000000000003', true, false)), 'target_still_active',
  'restoration waits while the rank is still active');
select is(pg_temp.st('a1200000-0000-4000-8000-000000000003'), 'consumed',
  'A FAILED REVOCATION LEAVES RESTORATION RETRYABLE — not stranded in review');

-- 3c. The revocation lands. The retry now succeeds.
update public.entitlements set status='revoked'
where user_id='a1000000-0000-4000-8000-000000000003'
  and entitlement_key in ('product:real-supporter-permanent','product:realvip-permanent')
  and metadata->>'source' <> 'order';
update public.entitlements set status='revoked'
where user_id='a1000000-0000-4000-8000-000000000003'
  and entitlement_key='product:real-supporter-permanent';

select is((select outcome from public.restore_upgrade_credit_after_refund(
  'a1200000-0000-4000-8000-000000000003', true, false)), 'restored',
  'A SUCCESSFUL RETRY RESTORES IT');
select is(pg_temp.st('a1200000-0000-4000-8000-000000000003'), 'released',
  'the SAME reservation row goes back to available — never a second credit');
select is((select count(*)::integer from public.upgrade_credit_reservations
  where order_id='a1200000-0000-4000-8000-000000000003'), 1,
  'exactly one reservation row exists for that order, ever');

-- The source RealVIP purchase is untouched and still owned.
select ok(pg_temp.owns('a1000000-0000-4000-8000-000000000003','realvip-permanent'),
  'the SOURCE RealVIP purchase remains valid and owned');
select is((select status::text from public.orders
  where id='a1100000-0000-4000-8000-000000000003'), 'fulfilled',
  'the source order is untouched by the upgraded order''s refund');

-- The manual grant is untouched.
select ok(pg_temp.owns('a1000000-0000-4000-8000-000000000003','realpets'),
  'an unrelated manual grant is untouched');

-- Restoring twice cannot create a second credit.
select is((select outcome from public.restore_upgrade_credit_after_refund(
  'a1200000-0000-4000-8000-000000000003', true, false)), 'no_consumed_reservation',
  'restoration is idempotent — the credit is available AT MOST once');

-- And the customer can genuinely upgrade again.
select is((select reason from public.compute_upgrade_price(
  'a1000000-0000-4000-8000-000000000003','real-supporter-permanent')), 'ok',
  'the restored eligibility is real: a fresh upgrade quote succeeds');
select is((select credit_cents from public.compute_upgrade_price(
  'a1000000-0000-4000-8000-000000000003','real-supporter-permanent')), 1299::bigint,
  'worth exactly the original 1299, not a cent more');

-- ===========================================================================
-- PART 4: a chargeback on the upgraded order never restores
-- ===========================================================================
update public.upgrade_credit_reservations set state='consumed', released_reason=null
where order_id='a1200000-0000-4000-8000-000000000003';
select is((select outcome from public.restore_upgrade_credit_after_refund(
  'a1200000-0000-4000-8000-000000000003', true, true)), 'chargeback_needs_review',
  'a chargeback on the upgraded order goes to review, never auto-restores');
select is(pg_temp.st('a1200000-0000-4000-8000-000000000003'), 'needs_review',
  'and the credit stays out of circulation');

select * from finish();
rollback;
