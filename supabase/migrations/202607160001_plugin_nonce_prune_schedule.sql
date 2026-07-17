-- Schedule the plugin nonce prune, and make the prune safe at any table size.
--
-- Why: 202605200004 shipped cleanup_plugin_request_nonces() with its scheduling as
-- a comment ("enable it per-environment"). No environment ever did. Production
-- accumulated 5,991,360 nonce rows of which 5,990,952 were expired garbage — a
-- nonce is only meaningful inside the 5 minute HMAC window, so ~408 rows are live
-- at any moment. The bloated primary key index exhausted the project's disk IO
-- budget, nonce inserts began timing out (522), plugin auth turned those into 503
-- "retry later", and RealCore's retries fed the loop. 100% of plugin requests
-- failed. A comment is not a schedule; this migration makes it real.

-- 1. Batched prune. The old version issued one unbounded DELETE, which is exactly
-- what cannot recover once the table is behind: it times out, rolls back, and
-- makes zero progress forever, while spiking IO on every attempt. Deleting a
-- bounded slice per run always makes progress. Steady state is ~1k expired rows
-- per 15 minutes, so the default limit carries ~50x headroom and drains any
-- realistic backlog within hours without an IO spike.
--
-- Signature changes from () to (integer default), so the old function must be
-- dropped rather than replaced — an overload would make the no-arg call ambiguous.
drop function if exists public.cleanup_plugin_request_nonces();

create or replace function public.cleanup_plugin_request_nonces(p_limit integer default 50000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  with expired as (
    select nonce_hash
    from public.plugin_request_nonces
    where expires_at < now()
    order by expires_at
    limit greatest(1, p_limit)
  )
  delete from public.plugin_request_nonces n
  using expired
  where n.nonce_hash = expired.nonce_hash;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_plugin_request_nonces(integer) from public;
revoke all on function public.cleanup_plugin_request_nonces(integer) from anon;
revoke all on function public.cleanup_plugin_request_nonces(integer) from authenticated;
grant execute on function public.cleanup_plugin_request_nonces(integer) to service_role;

-- 2. Schedule it. Guarded so environments without pg_cron (local `supabase db
-- reset`) no-op with a notice instead of failing the migration — that was the
-- original reason scheduling was left out, and it is satisfiable without leaving
-- production unscheduled.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron unavailable; skipping nonce prune schedule. Schedule public.cleanup_plugin_request_nonces() externally in this environment.';
    return;
  end if;

  -- No "with schema extensions": pg_cron's control file is relocatable=false,
  -- schema=pg_catalog, so naming a schema errors out. (The snippet commented into
  -- 202605200004 did exactly that and could never have run.) The extension's own
  -- script creates the `cron` schema and the cron.job table used below.
  execute 'create extension if not exists pg_cron';

  -- Idempotent: re-running this migration must not stack duplicate jobs.
  if exists (select 1 from cron.job where jobname = 'cleanup-plugin-request-nonces') then
    perform cron.unschedule('cleanup-plugin-request-nonces');
  end if;

  perform cron.schedule(
    'cleanup-plugin-request-nonces',
    '*/15 * * * *',
    $cron$select public.cleanup_plugin_request_nonces();$cron$
  );
end;
$$;
