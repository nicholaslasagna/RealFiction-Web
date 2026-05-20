-- Plugin nonce rows are only meaningful inside the HMAC timestamp window.
-- Replay protection does NOT depend on this cleanup: the primary key blocks nonce
-- reuse, and stale timestamps are rejected by the HMAC window. This function only
-- prevents plugin_request_nonces from growing without bound.

create or replace function public.cleanup_plugin_request_nonces()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.plugin_request_nonces
  where expires_at < now();

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_plugin_request_nonces() from public;
revoke all on function public.cleanup_plugin_request_nonces() from anon;
revoke all on function public.cleanup_plugin_request_nonces() from authenticated;
grant execute on function public.cleanup_plugin_request_nonces() to service_role;

-- Scheduling is intentionally left out of this migration so local `supabase db reset`
-- and CI stay deterministic and do not require the pg_cron extension. Enable and
-- schedule it per-environment (Supabase supports pg_cron):
--
--   create extension if not exists pg_cron with schema extensions;
--   select cron.schedule(
--     'cleanup-plugin-request-nonces',
--     '*/15 * * * *',
--     $$select public.cleanup_plugin_request_nonces();$$
--   );
--
-- Alternatively, call public.cleanup_plugin_request_nonces() from a scheduled
-- Cloudflare Worker / external cron using the Supabase service role.
