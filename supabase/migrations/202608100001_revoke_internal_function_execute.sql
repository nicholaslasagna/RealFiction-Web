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
-- Guard: no SECURITY DEFINER function may be left callable by anon
-- ---------------------------------------------------------------------------
-- Fails the migration if a new one appears, so this class of mistake cannot be
-- reintroduced silently. The two announcement readers are the documented
-- exceptions above; `is_admin` is safe because it only ever describes its own
-- caller.
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
    and (p.proacl is null or p.proacl::text like '%anon=%');

  if v_leaked is not null then
    raise exception 'ABORT: SECURITY DEFINER function(s) still callable by anon: %', v_leaked;
  end if;
end $$;
