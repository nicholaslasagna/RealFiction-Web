-- No untrusted role may reach an internal privileged function.
--
-- Postgres grants EXECUTE to PUBLIC by default, and PostgREST publishes every
-- function in `public` as an RPC. `_add_playtime_total` was reachable that way
-- by anyone holding the anon key, which ships in the client bundle by design.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- ===========================================================================
-- The specific hole
-- ===========================================================================
select ok(
  not has_function_privilege('anon', 'public._add_playtime_total(text,text,text,integer)', 'execute'),
  'ANON CANNOT execute _add_playtime_total'
);
select ok(
  not has_function_privilege('authenticated', 'public._add_playtime_total(text,text,text,integer)', 'execute'),
  'an authenticated player cannot execute it either'
);
select ok(
  has_function_privilege('service_role', 'public._add_playtime_total(text,text,text,integer)', 'execute'),
  'service_role KEEPS it — the plugin ingestion path needs it'
);

-- ===========================================================================
-- The class of mistake
-- ===========================================================================
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.proname not in ('is_admin', 'published_announcements', 'latest_announcement')
     and (p.proacl is null or p.proacl::text like '%anon=%')),
  'none',
  'NO other SECURITY DEFINER function is callable by anon'
);

-- is_admin is the documented exception: it reports the CALLER's own status from
-- auth.uid() and takes no argument, so it discloses nothing they do not know.
select ok(
  has_function_privilege('authenticated', 'public.is_admin()', 'execute'),
  'is_admin stays callable, by design'
);

-- ===========================================================================
-- And the money functions were never exposed
-- ===========================================================================
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'admin_import_economy_balances', 'admin_rollback_economy_import',
       'publish_announcement', 'unpublish_announcement', 'claim_gift_card',
       'reserve_credit_lots', 'request_cash_redemption', 'issue_gift_card_for_order')
     and (p.proacl is null or p.proacl::text like '%anon=%' or p.proacl::text like '%authenticated=%')),
  0,
  'NO financial or privileged function is reachable by anon or authenticated'
);

select * from finish();
rollback;
