-- Network stats expansion: idempotent event ingestion + homepage summary.
--
-- Builds on migration 016. Producers (votes, kills, deaths, blocks_broken,
-- money mirror, ...) batch their writes in RealCore and POST one batch at a
-- time to /api/plugin/stats/events with a producer-generated batch_id. This
-- migration adds:
--
--   * network_stat_batches  - dedup ledger keyed by batch_id (uuid).
--   * apply_network_stat_events - applies a batch atomically; idempotent on
--     duplicate batch_id (returns duplicate=true and no-ops).
--   * network_summary - cheap homepage aggregate (total network playtime +
--     tracked players) backed by playtime_totals.
--   * cleanup_network_stat_batches - prune helper for the dedup ledger.
--
-- Constraints honored:
--   * Additive only. Migrations 014/015/016 are not modified.
--   * upsert_network_stat (from 016) is reused as-is; this migration does not
--     redefine it.
--   * apply_playtime_events / playtime mirroring are unchanged.

-- Idempotency ledger. One row per producer flush. event_count is bookkeeping
-- only (used by /rf stats and for sanity checks); the dedup itself is the
-- primary key on batch_id.
create table if not exists public.network_stat_batches (
  batch_id uuid primary key,
  server_id text not null,
  applied_at timestamptz not null default now(),
  event_count integer not null default 0
);

create index if not exists network_stat_batches_applied_idx
  on public.network_stat_batches (applied_at);

create index if not exists network_stat_batches_server_idx
  on public.network_stat_batches (server_id, applied_at desc);

alter table public.network_stat_batches enable row level security;

drop policy if exists "network_stat_batches_admin" on public.network_stat_batches;
create policy "network_stat_batches_admin" on public.network_stat_batches for all
  using (public.is_admin()) with check (public.is_admin());

-- Apply a batch of stat events atomically and idempotently.
--
-- p_events shape (jsonb array): [
--   { "statKey": "kills.total",
--     "subjectType": "player",        -- optional, defaults to 'player'
--     "subjectId":  "<uuid>",
--     "displayName": "Alex",          -- optional
--     "value": 1,                     -- numeric; meaning depends on mode
--     "mode":  "increment" }          -- 'increment' | 'set' (default 'increment')
-- ]
--
-- Behavior:
--   * INSERT (batch_id) ON CONFLICT DO NOTHING. If the row already existed,
--     the batch was already applied; we return (applied_count=0, duplicate=true)
--     and skip the loop. Safe to retry the same batch_id from RealCore.
--   * Otherwise iterate events and call upsert_network_stat(... mode) for each.
--   * Validation is intentionally light: malformed individual events are
--     rejected via upsert_network_stat (which raises on missing key/subject).
--     The API route enforces shape with zod before this is reached.
--
-- Errors during the loop bubble up; the transaction rolls back including the
-- ledger insert, so a failed batch can be retried with the same batch_id.
create or replace function public.apply_network_stat_events(
  p_server_id text,
  p_batch_id uuid,
  p_events jsonb
)
returns table(applied_count integer, duplicate boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event jsonb;
  v_applied integer := 0;
  v_event_count integer;
  v_inserted_rows integer;
begin
  if p_batch_id is null then
    raise exception 'batch_id is required';
  end if;
  if p_server_id is null or p_server_id = '' then
    raise exception 'server_id is required';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'events must be a JSON array';
  end if;

  v_event_count := jsonb_array_length(p_events);

  insert into public.network_stat_batches (batch_id, server_id, applied_at, event_count)
  values (p_batch_id, p_server_id, now(), v_event_count)
  on conflict (batch_id) do nothing;

  get diagnostics v_inserted_rows = row_count;

  if v_inserted_rows = 0 then
    return query select 0::integer, true::boolean;
    return;
  end if;

  for v_event in select value from jsonb_array_elements(p_events) loop
    perform public.upsert_network_stat(
      v_event->>'statKey',
      coalesce(nullif(v_event->>'subjectType', ''), 'player'),
      v_event->>'subjectId',
      nullif(v_event->>'displayName', ''),
      coalesce((v_event->>'value')::numeric, 0),
      coalesce(nullif(v_event->>'mode', ''), 'increment')
    );
    v_applied := v_applied + 1;
  end loop;

  return query select v_applied, false::boolean;
end;
$$;

-- Cheap homepage summary. Reads only from playtime_totals.server_group = 'all'
-- so it is O(rows-with-group='all'); the index on (minecraft_uuid, server_group)
-- (PK in migration 015) is enough. Designed to be safe to call on every page
-- render but the API route will still cache via CDN.
--
-- Returns:
--   total_playtime_seconds : sum of total_seconds across the global group
--   tracked_players        : distinct UUIDs in the global group
--   refreshed_at           : now() (the value is computed live)
create or replace function public.network_summary()
returns table(
  total_playtime_seconds bigint,
  tracked_players integer,
  refreshed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    coalesce(sum(pt.total_seconds), 0)::bigint as total_playtime_seconds,
    count(distinct pt.minecraft_uuid)::integer as tracked_players,
    now() as refreshed_at
  from public.playtime_totals pt
  where pt.server_group = 'all';
end;
$$;

-- Operational helper. Prune ledger rows older than p_max_age_days. Safe to run
-- whenever; we keep ~14 days by default so a stuck client retrying an old
-- batch_id during that window is still deduped.
create or replace function public.cleanup_network_stat_batches(
  p_max_age_days integer default 14
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.network_stat_batches
  where applied_at < now() - make_interval(days => greatest(coalesce(p_max_age_days, 14), 1));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Service-role only. apply_network_stat_events is the write path used by the
-- HMAC-authenticated plugin route; network_summary is reused by the public
-- summary route (still service-role from the server).
revoke all on function public.apply_network_stat_events(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_network_stat_events(text, uuid, jsonb) to service_role;

revoke all on function public.network_summary() from public, anon, authenticated;
grant execute on function public.network_summary() to service_role;

revoke all on function public.cleanup_network_stat_batches(integer) from public, anon, authenticated;
grant execute on function public.cleanup_network_stat_batches(integer) to service_role;
