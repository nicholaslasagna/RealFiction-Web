-- Network stats foundation: a generic, reusable stat + leaderboard backbone.
--
-- Future systems (kills/deaths, economy, votes, faction power, crates, seasonal
-- progression, ...) write a single normalized totals table keyed by a dotted
-- stat key (e.g. 'playtime.total', 'votes.total', 'economy.balance') and a
-- subject (player today; faction/entity later). Top-N leaderboards are served
-- from a periodically refreshed cache so reads never hammer the totals table.
--
-- Additive only: playtime_sessions / playtime_totals / their RPCs are unchanged
-- except that playtime now ALSO mirrors its authoritative totals into the
-- generic table (as a 'set', so no double counting).

-- Generic per-subject totals (source of truth for non-playtime stats; mirror
-- target for playtime). value is numeric so integer counts, cents, and scaled
-- metrics all fit without a forced scale.
create table if not exists public.network_stat_totals (
  stat_key text not null,
  subject_type text not null default 'player',
  subject_id text not null,
  display_name text,
  value numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (stat_key, subject_type, subject_id)
);

create index if not exists network_stat_totals_leaderboard_idx
  on public.network_stat_totals (stat_key, subject_type, value desc);

-- Denormalized top-N snapshot per (stat_key, subject_type). Read path for
-- placeholders/holograms/website so the totals table is only scanned on refresh.
create table if not exists public.network_leaderboard_cache (
  stat_key text not null,
  subject_type text not null default 'player',
  position integer not null,
  subject_id text not null,
  display_name text,
  value numeric not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (stat_key, subject_type, position)
);

alter table public.network_stat_totals enable row level security;
alter table public.network_leaderboard_cache enable row level security;

drop policy if exists "network_stat_totals_admin" on public.network_stat_totals;
create policy "network_stat_totals_admin" on public.network_stat_totals for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "network_leaderboard_cache_admin" on public.network_leaderboard_cache;
create policy "network_leaderboard_cache_admin" on public.network_leaderboard_cache for all
  using (public.is_admin()) with check (public.is_admin());

-- Generic write used by future stat producers (set or increment).
create or replace function public.upsert_network_stat(
  p_stat_key text,
  p_subject_type text,
  p_subject_id text,
  p_display_name text,
  p_value numeric,
  p_mode text default 'set'
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new numeric;
begin
  if p_stat_key is null or p_stat_key = '' or p_subject_id is null or p_subject_id = '' then
    raise exception 'stat_key and subject_id are required';
  end if;

  if lower(coalesce(p_mode, 'set')) = 'increment' then
    insert into public.network_stat_totals (stat_key, subject_type, subject_id, display_name, value, updated_at)
    values (p_stat_key, coalesce(p_subject_type, 'player'), p_subject_id, p_display_name, coalesce(p_value, 0), now())
    on conflict (stat_key, subject_type, subject_id) do update set
      value = public.network_stat_totals.value + coalesce(excluded.value, 0),
      display_name = coalesce(excluded.display_name, public.network_stat_totals.display_name),
      updated_at = now()
    returning value into v_new;
  else
    insert into public.network_stat_totals (stat_key, subject_type, subject_id, display_name, value, updated_at)
    values (p_stat_key, coalesce(p_subject_type, 'player'), p_subject_id, p_display_name, coalesce(p_value, 0), now())
    on conflict (stat_key, subject_type, subject_id) do update set
      value = coalesce(excluded.value, 0),
      display_name = coalesce(excluded.display_name, public.network_stat_totals.display_name),
      updated_at = now()
    returning value into v_new;
  end if;

  return v_new;
end;
$$;

-- Recompute the cached top-N snapshot for one (stat_key, subject_type).
create or replace function public.refresh_stat_leaderboard_cache(
  p_stat_key text,
  p_subject_type text default 'player',
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_type text := coalesce(nullif(p_subject_type, ''), 'player');
begin
  -- Serialize concurrent refreshes of the same board so the delete+insert below
  -- cannot race into a cache primary-key conflict. Released at transaction end.
  perform pg_advisory_xact_lock(hashtext(p_stat_key), hashtext(v_type));

  delete from public.network_leaderboard_cache c
  where c.stat_key = p_stat_key and c.subject_type = v_type;

  insert into public.network_leaderboard_cache (stat_key, subject_type, position, subject_id, display_name, value, refreshed_at)
  select
    p_stat_key,
    v_type,
    (row_number() over (order by t.value desc, t.subject_id asc))::integer,
    t.subject_id,
    t.display_name,
    t.value,
    now()
  from public.network_stat_totals t
  where t.stat_key = p_stat_key and t.subject_type = v_type and t.value > 0
  order by t.value desc, t.subject_id asc
  limit least(greatest(coalesce(p_limit, 100), 1), 1000);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Read top-N from the cache, lazily refreshing it when older than p_max_age.
create or replace function public.get_stat_leaderboard(
  p_stat_key text,
  p_subject_type text default 'player',
  p_limit integer default 10,
  p_max_age_seconds integer default 60
)
returns table(
  position integer,
  subject_id text,
  display_name text,
  value numeric,
  refreshed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := coalesce(nullif(p_subject_type, ''), 'player');
  v_fresh timestamptz;
begin
  select max(c.refreshed_at) into v_fresh
  from public.network_leaderboard_cache c
  where c.stat_key = p_stat_key and c.subject_type = v_type;

  if v_fresh is null or v_fresh < now() - make_interval(secs => greatest(5, coalesce(p_max_age_seconds, 60))) then
    perform public.refresh_stat_leaderboard_cache(p_stat_key, v_type, greatest(coalesce(p_limit, 10), 100));
  end if;

  return query
  select c.position, c.subject_id, c.display_name, c.value, c.refreshed_at
  from public.network_leaderboard_cache c
  where c.stat_key = p_stat_key and c.subject_type = v_type
  order by c.position asc
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
end;
$$;

-- Replaces the migration-015 SQL helper with the same playtime_totals upsert
-- semantics, plus a mirror write. apply_playtime_events is unchanged and still
-- calls this function with positive deltas only:
--   * playtime_totals.total_seconds += delta (idempotent via session math)
--   * network_stat_totals.value = returned total (absolute set, not += delta)
-- So network_stat_totals never double-counts. All column refs are table-qualified.
-- Group 'all' maps to stat_key 'playtime.total'.
create or replace function public._add_playtime_total(
  p_uuid text,
  p_group text,
  p_username text,
  p_seconds integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint;
  v_stat_key text;
begin
  insert into public.playtime_totals (minecraft_uuid, server_group, minecraft_username, total_seconds, last_seen_at, updated_at)
  values (p_uuid, p_group, p_username, greatest(0, p_seconds), now(), now())
  on conflict (minecraft_uuid, server_group) do update set
    total_seconds = public.playtime_totals.total_seconds + greatest(0, excluded.total_seconds),
    minecraft_username = coalesce(excluded.minecraft_username, public.playtime_totals.minecraft_username),
    last_seen_at = now(),
    updated_at = now()
  returning total_seconds into v_total;

  v_stat_key := case when p_group = 'all' then 'playtime.total' else 'playtime.' || p_group end;

  insert into public.network_stat_totals (stat_key, subject_type, subject_id, display_name, value, updated_at)
  values (v_stat_key, 'player', p_uuid, p_username, v_total, now())
  on conflict (stat_key, subject_type, subject_id) do update set
    value = excluded.value,
    display_name = coalesce(excluded.display_name, public.network_stat_totals.display_name),
    updated_at = now();
end;
$$;

-- Seed generic totals from existing playtime data (no double-count; mirrors
-- authoritative playtime_totals as a one-time set).
insert into public.network_stat_totals (stat_key, subject_type, subject_id, display_name, value, updated_at)
select
  case
    when pt.server_group = 'all' then 'playtime.total'
    else 'playtime.' || pt.server_group
  end,
  'player',
  pt.minecraft_uuid,
  pt.minecraft_username,
  pt.total_seconds::numeric,
  pt.updated_at
from public.playtime_totals pt
on conflict (stat_key, subject_type, subject_id) do update set
  value = excluded.value,
  display_name = coalesce(excluded.display_name, public.network_stat_totals.display_name),
  updated_at = excluded.updated_at;

revoke all on function public.upsert_network_stat(text, text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.upsert_network_stat(text, text, text, text, numeric, text) to service_role;

revoke all on function public.refresh_stat_leaderboard_cache(text, text, integer) from public, anon, authenticated;
grant execute on function public.refresh_stat_leaderboard_cache(text, text, integer) to service_role;

revoke all on function public.get_stat_leaderboard(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.get_stat_leaderboard(text, text, integer, integer) to service_role;
