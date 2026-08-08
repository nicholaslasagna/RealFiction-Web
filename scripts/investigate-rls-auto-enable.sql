-- READ-ONLY investigation of public.rls_auto_enable.
--
-- This function exists in production but in no repository migration. Nothing
-- here modifies it. Run this and send back the output; we can then decide
-- whether it belongs, should be version-controlled, or should be removed.
--
-- The pending security migration revokes PUBLIC/anon/authenticated EXECUTE from
-- it. That is a privilege change, not a destructive one — the function, its
-- body, and its owner are untouched, and service_role retains access.

-- 1. Identity, signature, security flags, and configuration
select
  n.nspname                                   as schema,
  p.proname                                   as name,
  pg_get_function_identity_arguments(p.oid)   as identity_args,
  pg_get_function_result(p.oid)               as returns,
  p.prokind                                   as kind,          -- f=function, p=procedure, t=trigger-returning
  p.prosecdef                                 as security_definer,
  pg_get_userbyid(p.proowner)                 as owner,
  l.lanname                                   as language,
  coalesce(array_to_string(p.proconfig, ', '), '(none)') as config,
  p.provolatile                               as volatility
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = 'public' and p.proname = 'rls_auto_enable';

-- 2. The complete definition
select pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'rls_auto_enable';

-- 3. EXECUTE privileges, expanded per grantee
--    A NULL acl means the Postgres default: EXECUTE to PUBLIC.
select
  p.proname,
  coalesce(p.proacl::text, 'NULL — default, i.e. EXECUTE to PUBLIC') as raw_acl,
  has_function_privilege('anon',          p.oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
  has_function_privilege('service_role',  p.oid, 'execute') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'rls_auto_enable';

-- 4. Is it wired to an EVENT TRIGGER?
--    The name suggests a DDL hook that enables RLS on newly created tables.
--    Event triggers execute as their owner, not the caller, which is why
--    revoking anon EXECUTE cannot break one.
select
  t.evtname        as event_trigger,
  t.evtevent       as fires_on,
  t.evtenabled     as enabled,
  pg_get_userbyid(t.evtowner) as trigger_owner,
  t.evttags        as command_tags
from pg_event_trigger t
join pg_proc p on p.oid = t.evtfoid
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'rls_auto_enable';

-- 5. Any ordinary table trigger using it
select
  c.relname as table_name,
  tg.tgname as trigger_name,
  pg_get_triggerdef(tg.oid) as definition
from pg_trigger tg
join pg_proc p on p.oid = tg.tgfoid
join pg_class c on c.oid = tg.tgrelid
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'rls_auto_enable' and not tg.tgisinternal;

-- 6. Other functions OR PROCEDURES whose body mentions it
--
-- LIMIT OF THIS QUERY, STATED PLAINLY: it is a text search of `prosrc`. It
-- finds a literal mention, including one inside dynamic SQL. It CANNOT find a
-- name assembled at runtime from fragments (format('rls_' || 'auto_enable')),
-- and it cannot see callers outside this database at all. An empty result here
-- means "no caller found", never "no caller exists".
select
  n.nspname  as schema,
  p.proname  as calling_routine,
  case p.prokind when 'f' then 'function' when 'p' then 'procedure'
                 when 'a' then 'aggregate' when 'w' then 'window' end as kind,
  p.prosecdef as caller_is_security_definer,
  -- The breakage criterion: a SECURITY INVOKER caller reachable by anon or
  -- authenticated WILL fail after the revoke. A DEFINER caller will not.
  (not p.prosecdef and (has_function_privilege('anon', p.oid, 'execute')
                        or has_function_privilege('authenticated', p.oid, 'execute')))
             as revoke_would_break_this_caller
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosrc like '%rls_auto_enable%'
  and p.proname <> 'rls_auto_enable'
order by revoke_would_break_this_caller desc, 1, 2;

-- 6b. Scheduled jobs, if pg_cron is installed
--
-- A cron job is a caller this database records but `prosrc` never mentions.
-- Skipped cleanly when pg_cron is absent rather than erroring.
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is not installed — no scheduled-job caller is possible';
  else
    raise notice 'pg_cron IS installed — inspect cron.job for references (query below)';
  end if;
end $$;

select jobid, schedule, command, nodename, username, active
from cron.job
where command like '%rls_auto_enable%';
-- If pg_cron is absent this statement errors with 42P01 (relation does not
-- exist). That is expected and harmless — the NOTICE above already told you.

-- 7. Is it owned by an extension? (i.e. installed, not hand-written)
select e.extname as owning_extension
from pg_depend d
join pg_extension e on e.oid = d.refobjid
join pg_proc p on p.oid = d.objid
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'rls_auto_enable' and d.deptype = 'e';

-- 8. Every OTHER public function absent from our migrations is worth the same
--    question. This lists SECURITY DEFINER functions and their current reach.
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  pg_get_userbyid(p.proowner)               as owner,
  has_function_privilege('anon', p.oid, 'execute')          as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by anon_can_execute desc, p.proname;
