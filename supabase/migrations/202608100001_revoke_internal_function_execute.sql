-- Removes PUBLIC execute from internal database helpers.
--
-- THE PROBLEM
-- ===========
-- Postgres grants EXECUTE on a new function to PUBLIC by default. Every
-- migration that created a helper without an explicit REVOKE therefore left it
-- callable by `anon` and `authenticated` — and PostgREST exposes every function
-- in the `public` schema as an RPC endpoint. A leading underscore hides nothing.
--
-- `_add_playtime_total(uuid, group, username, seconds)` was reachable that way:
-- SECURITY DEFINER, no authorization of its own, and it takes the target player
-- and the number of seconds as parameters. Anyone holding the anon key — which
-- is public by design, it ships in the client bundle — could POST to
--
--   /rest/v1/rpc/_add_playtime_total
--
-- and add arbitrary playtime to any player's totals. Verified against a
-- disposable database: executing it as the `anon` role succeeded and wrote a
-- playtime row for a UUID the caller does not own.
--
-- Playtime feeds the public leaderboards and network totals, so the impact is
-- forged public statistics rather than money. It is still a boundary that
-- should never have been open, and the same default would silently expose the
-- next helper somebody adds.
--
-- WHAT IS DELIBERATELY LEFT ALONE
-- ===============================
--   is_admin()                  must stay callable: it reports the CALLER's own
--                               status from auth.uid() and takes no argument, so
--                               it discloses nothing the caller does not know.
--   published_announcements()   intentionally public — they return only
--   latest_announcement()       published rows, which is the whole point.
--
-- Trigger functions are revoked as defence in depth. Calling one directly
-- already fails (it needs a trigger context), but there is no reason for the
-- grant to exist.

-- Internal helper. Never called by application code; only by other functions,
-- which run as their own owner and are unaffected by this revoke.
-- TRANSACTIONAL. Postgres DDL and GRANT/REVOKE are transactional, so a failure
-- anywhere below rolls the whole thing back and leaves production exactly as it
-- was. Without this, a failure in the deny-by-default sweep would leave some
-- functions revoked and others not — a half-applied privilege change nobody
-- could reason about afterwards.
begin;

revoke all on function public._add_playtime_total(text, text, text, integer)
from public, anon, authenticated;

do $$
begin
  -- service_role keeps it: the plugin ingestion path runs as service_role and
  -- reaches this helper through the functions that call it.
  execute 'grant execute on function public._add_playtime_total(text, text, text, integer) to service_role';
exception when undefined_function then
  raise notice 'skipping _add_playtime_total grant: signature not present';
end $$;

-- Trigger functions. Defence in depth.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.close_checkout_attempt_on_terminal_order()',
    'public.prevent_profile_role_escalation()'
  ] loop
    begin
      execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    exception when undefined_function then
      raise notice 'skipping %, not present', v_fn;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- DENY BY DEFAULT across the whole schema
-- ---------------------------------------------------------------------------
-- The first version of this migration ABORTED when it found a SECURITY DEFINER
-- function still callable by anon. Applied to production it failed on:
--
--   ABORT: SECURITY DEFINER function(s) still callable by anon: rls_auto_enable
--
-- `rls_auto_enable` does not exist anywhere in this repository. It was created
-- out of band — the Supabase SQL editor, a dashboard feature, or an extension —
-- so production carries a privileged function that version control does not
-- know about. An allowlist of "functions this repo created" can never be
-- complete against that, and aborting just leaves the real hole open.
--
-- So this REVOKES rather than asserts: every SECURITY DEFINER function in
-- `public` loses PUBLIC/anon/authenticated EXECUTE unless it is one of the
-- three documented exceptions. Unknown functions are denied, which is the only
-- safe default for something nobody in this repo can review.
--
-- This is safe for an event-trigger helper like `rls_auto_enable`: event
-- triggers fire on DDL and run as the event-trigger owner, not as the caller,
-- so no EXECUTE grant to anon is needed for them to work. If some function DOES
-- legitimately need anon access, it will surface immediately and can be added
-- to the exception list deliberately rather than by accident.
do $$
declare
  v_fn record;
  v_revoked text[] := '{}';
begin
  for v_fn in
    select p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      -- The documented exceptions:
      --   is_admin()                describes only its OWN caller via auth.uid()
      --   published_announcements() return published rows only — that is their
      --   latest_announcement()     entire purpose
      and p.proname not in ('is_admin', 'published_announcements', 'latest_announcement')
      and (p.proacl is null or p.proacl::text like '%anon=%' or p.proacl::text like '%authenticated=%')
  loop
    execute format(
      'revoke all on function public.%I(%s) from public, anon, authenticated',
      v_fn.proname, v_fn.args
    );
    v_revoked := v_revoked || (v_fn.proname || '(' || v_fn.args || ')');
  end loop;

  if array_length(v_revoked, 1) > 0 then
    raise notice 'Revoked PUBLIC/anon/authenticated EXECUTE from: %', array_to_string(v_revoked, ', ');
  else
    raise notice 'No SECURITY DEFINER function required revoking.';
  end if;
end $$;

-- Now assert. After the loop above this can only fail if a function was created
-- concurrently, which is worth stopping for.
do $$
declare
  v_leaked text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_leaked
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and p.proname not in ('is_admin', 'published_announcements', 'latest_announcement')
    and (p.proacl is null or p.proacl::text like '%anon=%' or p.proacl::text like '%authenticated=%');

  if v_leaked is not null then
    raise exception 'ABORT: SECURITY DEFINER function(s) still callable by anon: %', v_leaked;
  end if;
end $$;

commit;
