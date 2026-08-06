-- Nothing in the upgrade, reconciliation, or refund machinery may be reachable
-- by a logged-in customer.
--
-- These are not hypotheticals. Supabase exposes every function the
-- `authenticated` role can execute as a PostgREST RPC endpoint, and it GRANTS
-- table privileges by default. A single missing revoke turns
-- `apply_upgrade_reconciliation` into "any customer can declare their own order
-- paid", and a missing RLS policy turns the reservation ledger into a public
-- read of everyone's purchase history.

begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- Functions that decide money or entitlement outcomes.
create or replace function pg_temp.reachable(p_name text) returns boolean language sql as $$
  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'),('authenticated'),('public')) r(rolname)
    where n.nspname = 'public' and p.proname = p_name
      and has_function_privilege(r.rolname, p.oid, 'execute')
  );
$$;

select ok(not pg_temp.reachable('claim_upgrade_reconciliations'),
  'a customer cannot CLAIM a reconciliation row');
select ok(not pg_temp.reachable('apply_upgrade_reconciliation'),
  'a customer cannot SUBMIT a provider verdict — no self-declared "paid"');
select ok(not pg_temp.reachable('finish_upgrade_reconciliation'),
  'a customer cannot close out a reconciliation');
select ok(not pg_temp.reachable('request_order_cancellation'),
  'a customer cannot drive cancellation directly');
select ok(not pg_temp.reachable('mark_order_unpaid_closed'),
  'a customer cannot forge a completed cancellation');
select ok(not pg_temp.reachable('reserve_upgrade_credit'),
  'a customer cannot reserve their own upgrade credit');
select ok(not pg_temp.reachable('release_upgrade_credit'),
  'or release one');
select ok(not pg_temp.reachable('consume_upgrade_credit_for_order'),
  'or consume one outside fulfilment');
select ok(not pg_temp.reachable('compute_upgrade_price'),
  'or ask for a price quote without going through the server');
select ok(not pg_temp.reachable('record_order_refund'),
  'a customer cannot record a refund against their own order');
select ok(not pg_temp.reachable('restore_upgrade_credit_after_refund'),
  'or restore their own upgrade eligibility');
select ok(not pg_temp.reachable('fulfill_paid_order_with_outbox'),
  'and above all cannot fulfil an order');
select ok(not pg_temp.reachable('revoke_order_with_refund_outbox'),
  'or revoke one');
select ok(not pg_temp.reachable('expire_stale_upgrade_reservations'),
  'or run the sweep');
select ok(not pg_temp.reachable('order_refund_state'),
  'or read the refund position of an arbitrary order');
select ok(not pg_temp.reachable('get_store_credit_balance'),
  'or read an arbitrary store-credit balance');

-- Every SECURITY DEFINER function pins its search_path. Without the pin, a
-- caller who can create a schema can redirect an unqualified reference inside a
-- function that runs as the owner.
select is((select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
  where n.nspname = 'public' and p.prosecdef and d.objid is null
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  0, 'every SECURITY DEFINER function has a fixed search_path');

-- Tables. RLS is on with no policies, AND the default grants are revoked.
create or replace function pg_temp.locked(p_table text) returns boolean language sql as $$
  select (select relrowsecurity from pg_class where oid = ('public.'||p_table)::regclass)
     and not exists (
       select 1 from information_schema.role_table_grants
       where table_schema = 'public' and table_name = p_table
         and grantee in ('anon','authenticated','PUBLIC')
     );
$$;

select ok(pg_temp.locked('upgrade_credit_reservations'),
  'the reservation ledger is RLS-enabled AND has no client grants');
select ok(pg_temp.locked('upgrade_reconciliations'),
  'the reconciliation audit trail is closed to clients');
select ok(pg_temp.locked('order_refunds'),
  'the per-tender refund record is closed to clients');

-- No policies exist on these tables at all: service-role only, by construction.
select is((select count(*)::integer from pg_policies
  where schemaname='public'
    and tablename in ('upgrade_credit_reservations','upgrade_reconciliations','order_refunds')),
  0, 'and no RLS policy grants any client a way in');

-- A verdict is bound to one reservation, and a bogus id changes nothing.
select is((select outcome from public.apply_upgrade_reconciliation(
  '00000000-0000-4000-8000-0000000000ff','paid','cs_nonexistent')),
  'reservation_not_found', 'a verdict for an unknown reservation is inert');
select is((select count(*)::integer from public.upgrade_reconciliations), 0,
  'and leaves no audit row behind either');

select * from finish();
rollback;
