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

-- SUPERSEDED by 202607160001_plugin_nonce_prune_schedule.sql, which batches this
-- prune and schedules it with pg_cron. Do not rely on the guidance that used to
-- live here: leaving the schedule as a per-environment exercise meant no
-- environment ever did it, the table reached ~6M rows (99.99% expired), disk IO
-- was exhausted, and every plugin request failed. The snippet suggested here also
-- specified `with schema extensions`, which errors — pg_cron is relocatable=false,
-- schema=pg_catalog.
