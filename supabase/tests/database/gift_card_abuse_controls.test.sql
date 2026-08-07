-- Velocity controls: a normal customer is untouched, an abuser is not.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id,email) values
  ('6a000000-0000-4000-8000-000000000001','normal@e.test'),
  ('6a000000-0000-4000-8000-000000000002','rapid@e.test'),
  ('6a000000-0000-4000-8000-000000000003','whale@e.test'),
  ('6a000000-0000-4000-8000-000000000004','cycler@e.test') on conflict do nothing;
insert into public.profiles (id,email) select id,email from auth.users where id::text like '6a000000%' on conflict do nothing;

-- ===========================================================================
-- The normal customer
-- ===========================================================================
select is((select decision from public.evaluate_gift_card_velocity(
  '6a000000-0000-4000-8000-000000000001', null, null, 'r-hash-1', 2500)), 'allow',
  'A FIRST $25 GIFT CARD IS ALLOWED');

select public.record_abuse_event('gift_card_checkout','6a000000-0000-4000-8000-000000000001',null,null,'r-hash-1',0);
select public.record_abuse_event('gift_card_purchase','6a000000-0000-4000-8000-000000000001',null,null,'r-hash-1',2500);
select is((select decision from public.evaluate_gift_card_velocity(
  '6a000000-0000-4000-8000-000000000001', null, null, 'r-hash-2', 5000)), 'allow',
  'and a second card to a second person is still allowed');

select is((select count(*)::integer from public.abuse_events
  where actor='6a000000-0000-4000-8000-000000000001' and subject_kind='account'), 2,
  'both acts were recorded durably');

-- ===========================================================================
-- Rapid repeated checkout
-- ===========================================================================
insert into public.abuse_events (kind, actor, subject_kind, subject)
select 'gift_card_checkout','6a000000-0000-4000-8000-000000000002','account','6a000000-0000-4000-8000-000000000002'
from generate_series(1, 6);

select is((select decision from public.evaluate_gift_card_velocity(
  '6a000000-0000-4000-8000-000000000002', null, null, 'r-hash-9', 2500)), 'review',
  'SIX rapid checkouts reaches the review threshold');
select is((select rule from public.evaluate_gift_card_velocity(
  '6a000000-0000-4000-8000-000000000002', null, null, 'r-hash-9', 2500)), 'checkout_attempts_10m',
  'and names the rule INTERNALLY');

insert into public.abuse_events (kind, actor, subject_kind, subject)
select 'gift_card_checkout','6a000000-0000-4000-8000-000000000002','account','6a000000-0000-4000-8000-000000000002'
from generate_series(1, 6);
select is((select decision from public.evaluate_gift_card_velocity(
  '6a000000-0000-4000-8000-000000000002', null, null, 'r-hash-9', 2500)), 'block',
  'TWELVE rapid checkouts is blocked');

-- An OLD burst does not count: the window is real.
update public.abuse_events set occurred_at = now() - interval '2 hours'
where actor='6a000000-0000-4000-8000-000000000002';
select is((select decision from public.evaluate_gift_card_velocity(
  '6a000000-0000-4000-8000-000000000002', null, null, 'r-hash-9', 2500)), 'allow',
  'and the block LIFTS once the window passes');

-- ===========================================================================
-- Value ceilings
-- ===========================================================================
insert into public.abuse_events (kind, actor, subject_kind, subject, amount_cents)
values ('gift_card_purchase','6a000000-0000-4000-8000-000000000003','account','6a000000-0000-4000-8000-000000000003',48000);

select is((select decision from public.evaluate_gift_card_velocity(
  '6a000000-0000-4000-8000-000000000003', null, null, 'r-hash-w', 2500)), 'review',
  'crossing $500 in 24h reaches review');
select is((select decision from public.evaluate_gift_card_velocity(
  '6a000000-0000-4000-8000-000000000003', null, null, 'r-hash-w', 60000)), 'block',
  'A SINGLE PURCHASE THAT WOULD CROSS $1000 IS BLOCKED BEFORE IT HAPPENS');
select is((select decision from public.evaluate_gift_card_velocity(
  '6a000000-0000-4000-8000-000000000003', null, null, 'r-hash-w', 100)), 'allow',
  'AND A SMALL PURCHASE ON THE SAME ACCOUNT IS STILL ALLOWED — the ceiling is on value, not on the account');

-- ===========================================================================
-- Recipient cycling
-- ===========================================================================
insert into public.abuse_events (kind, actor, subject_kind, subject)
select 'gift_card_checkout','6a000000-0000-4000-8000-000000000004','recipient','cycle-' || g
from generate_series(1, 4) g;

select is((select decision from public.evaluate_gift_card_velocity(
  '6a000000-0000-4000-8000-000000000004', null, null, 'cycle-5', 2500)), 'review',
  'a FIFTH distinct recipient in 24h reaches review');

insert into public.abuse_events (kind, actor, subject_kind, subject)
select 'gift_card_checkout','6a000000-0000-4000-8000-000000000004','recipient','cycle-' || g
from generate_series(5, 13) g;
select is((select decision from public.evaluate_gift_card_velocity(
  '6a000000-0000-4000-8000-000000000004', null, null, 'cycle-99', 2500)), 'block',
  'MANY RECIPIENTS RAPIDLY IS BLOCKED');

-- The same recipient repeatedly is a different rule.
delete from public.abuse_events where actor='6a000000-0000-4000-8000-000000000004';
insert into public.abuse_events (kind, actor, subject_kind, subject)
select 'gift_card_checkout','6a000000-0000-4000-8000-000000000004','recipient','same-target'
from generate_series(1, 4);
select is((select decision from public.evaluate_gift_card_velocity(
  '6a000000-0000-4000-8000-000000000004', null, null, 'same-target', 2500)), 'review',
  'and the SAME recipient over and over is caught separately');

-- ===========================================================================
-- IP, only when supplied
-- ===========================================================================
insert into public.abuse_events (kind, subject_kind, subject)
select 'gift_card_checkout','ip','ip-hash-abc' from generate_series(1, 40);

select is((select decision from public.evaluate_gift_card_velocity(
  '6a000000-0000-4000-8000-000000000001', null, 'ip-hash-abc', 'r-new', 2500)), 'block',
  'a saturated IP is blocked');
select is((select decision from public.evaluate_gift_card_velocity(
  '6a000000-0000-4000-8000-000000000001', null, null, 'r-new', 2500)), 'allow',
  'AND AN ABSENT IP NEVER MATCHES SOMEONE ELSE''S COUNTER');

-- ===========================================================================
-- Claim brute force and refund abuse
-- ===========================================================================
insert into public.abuse_events (kind, actor, subject_kind, subject)
select 'gift_card_claim_failure','6a000000-0000-4000-8000-000000000002','account','6a000000-0000-4000-8000-000000000002'
from generate_series(1, 6);

select is((select decision from public.evaluate_abuse_rule_for_actor(
  'claim_failures_15m','gift_card_claim_failure','6a000000-0000-4000-8000-000000000002')), 'block',
  'SIX FAILED CLAIMS IS THROTTLED');
select is((select decision from public.evaluate_abuse_rule_for_actor(
  'claim_failures_15m','gift_card_claim_failure','6a000000-0000-4000-8000-000000000001')), 'allow',
  'and a different account is unaffected');

insert into public.abuse_events (kind, actor, subject_kind, subject)
select 'gift_card_refund_request','6a000000-0000-4000-8000-000000000003','account','6a000000-0000-4000-8000-000000000003'
from generate_series(1, 3);
select is((select decision from public.evaluate_abuse_rule_for_actor(
  'refund_requests_24h','gift_card_refund_request','6a000000-0000-4000-8000-000000000003')), 'review',
  'THREE REFUND REQUESTS IN A DAY IS REVIEWED');

-- ===========================================================================
-- Reviews are deduped, and retention works
-- ===========================================================================
select public.record_velocity_review('6a000000-0000-4000-8000-000000000002','checkout_attempts_10m','gift_card_checkout');
select public.record_velocity_review('6a000000-0000-4000-8000-000000000002','checkout_attempts_10m','gift_card_checkout');
select is((select count(*)::integer from public.payment_reviews where event_type='gift_card_velocity'), 1,
  'the same rule tripped twice in a day makes ONE review item');

insert into public.abuse_events (kind, subject_kind, subject, occurred_at)
values ('gift_card_checkout','ip','old-ip', now() - interval '8 days'),
       ('gift_card_checkout','account','old-acct', now() - interval '50 days');
select is((select ip_rows from public.purge_abuse_events()), 1::bigint,
  'IP HASHES ARE PURGED AFTER 7 DAYS');
select is((select count(*)::integer from public.abuse_events where subject='old-acct'), 0,
  'and account rows after 45');

select * from finish();
rollback;
