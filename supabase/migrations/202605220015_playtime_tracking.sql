-- Network-wide playtime tracking + leaderboards.
--
-- Each backend (lobby/smp/factions/anarchy/arcade) records ITS OWN sessions and
-- reports cumulative "seconds since join" for the active session. The RPC adds
-- only the positive delta (reported - already-counted) into playtime_totals, so:
--   * retries/duplicate flushes add 0 (idempotent)
--   * a crash just stops reports; the last counted value already stuck (no over-
--     count) and the session is later marked stale (no under/over-count)
--   * a player is on exactly one backend at a time, so summing per-backend
--     sessions never double-counts a proxy transfer.
--
-- playtime_totals is keyed by (uuid, server_group) with a synthetic 'all' group
-- holding the network-wide total, so every leaderboard (total or per-group) is a
-- single indexed query.

-- Tables ---------------------------------------------------------------------
create table if not exists public.playtime_sessions (
  id uuid primary key default gen_random_uuid(),
  client_session_id text not null,
  minecraft_uuid text not null,
  minecraft_username text,
  server_id text not null,
  server_group text not null default 'global',
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per real connection. Keying on a client-generated id makes every
-- start/progress/end event idempotent: a retried 'end' lands on the same row,
-- and the cumulative-delta math adds 0 the second time.
create unique index if not exists playtime_sessions_client_uniq
  on public.playtime_sessions (client_session_id);

create index if not exists playtime_sessions_server_status_idx
  on public.playtime_sessions (server_id, status);

create index if not exists playtime_sessions_active_last_seen_idx
  on public.playtime_sessions (last_seen_at)
  where status = 'active';

create table if not exists public.playtime_totals (
  minecraft_uuid text not null,
  server_group text not null,
  minecraft_username text,
  total_seconds bigint not null default 0,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (minecraft_uuid, server_group)
);

-- Top-N per group (and 'all') in one indexed scan.
create index if not exists playtime_totals_leaderboard_idx
  on public.playtime_totals (server_group, total_seconds desc);

alter table public.playtime_sessions enable row level security;
alter table public.playtime_totals enable row level security;

drop policy if exists "playtime_sessions_admin" on public.playtime_sessions;
create policy "playtime_sessions_admin" on public.playtime_sessions for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "playtime_totals_admin" on public.playtime_totals;
create policy "playtime_totals_admin" on public.playtime_totals for all
  using (public.is_admin()) with check (public.is_admin());

-- Internal helper: idempotent additive upsert into the totals cache. Not granted
-- to any API role; only the security-definer functions below call it.
create or replace function public._add_playtime_total(
  p_uuid text,
  p_group text,
  p_username text,
  p_seconds integer
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.playtime_totals (minecraft_uuid, server_group, minecraft_username, total_seconds, last_seen_at, updated_at)
  values (p_uuid, p_group, p_username, greatest(0, p_seconds), now(), now())
  on conflict (minecraft_uuid, server_group) do update set
    total_seconds = public.playtime_totals.total_seconds + greatest(0, excluded.total_seconds),
    minecraft_username = coalesce(excluded.minecraft_username, public.playtime_totals.minecraft_username),
    last_seen_at = now(),
    updated_at = now();
$$;

-- Apply a batch of session events (start / progress / end) for one backend.
-- p_reconcile=true first marks this server's lingering active sessions stale
-- (crash recovery on plugin startup).
create or replace function public.apply_playtime_events(
  p_server_id text,
  p_server_group text,
  p_reconcile boolean default false,
  p_events jsonb default '[]'::jsonb
)
returns table(applied_events integer, reconciled_sessions integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_increment_cap constant integer := 86400; -- 1 day max per single report
  v_event jsonb;
  v_type text;
  v_session_id text;
  v_uuid text;
  v_username text;
  v_seconds integer;
  v_increment integer;
  v_applied integer := 0;
  v_reconciled integer := 0;
  v_session public.playtime_sessions%rowtype;
  v_group text := coalesce(nullif(p_server_group, ''), 'global');
begin
  if p_server_id is null or p_server_id = '' then
    raise exception 'server_id is required';
  end if;

  if p_reconcile then
    update public.playtime_sessions ps
    set status = 'stale', ended_at = ps.last_seen_at, updated_at = now()
    where ps.server_id = p_server_id and ps.status = 'active';
    get diagnostics v_reconciled = row_count;
  end if;

  for v_event in select value from jsonb_array_elements(coalesce(p_events, '[]'::jsonb))
  loop
    v_type := lower(coalesce(v_event->>'type', ''));
    v_session_id := nullif(v_event->>'sessionId', '');
    v_uuid := nullif(v_event->>'uuid', '');
    v_username := nullif(v_event->>'username', '');
    v_seconds := greatest(0, coalesce((v_event->>'seconds')::integer, 0));

    if v_uuid is null or v_session_id is null then
      continue;
    end if;

    if v_type = 'start' then
      -- Idempotent open: a retried start lands on the same client_session_id.
      insert into public.playtime_sessions (
        client_session_id, minecraft_uuid, minecraft_username, server_id, server_group,
        joined_at, last_seen_at, duration_seconds, status
      ) values (
        v_session_id, v_uuid, v_username, p_server_id, v_group, now(), now(), 0, 'active'
      )
      on conflict (client_session_id) do nothing;
      v_applied := v_applied + 1;

    elsif v_type in ('progress', 'end') then
      select * into v_session
      from public.playtime_sessions ps
      where ps.client_session_id = v_session_id
      for update;

      if found then
        -- Idempotent: only the growth past what we already counted is added, so
        -- a re-sent 'end' (after a lost response) adds 0.
        v_increment := least(c_increment_cap, greatest(0, v_seconds - v_session.duration_seconds));
        update public.playtime_sessions ps
        set duration_seconds = greatest(ps.duration_seconds, v_seconds),
            last_seen_at = now(),
            minecraft_username = coalesce(v_username, ps.minecraft_username),
            ended_at = case when v_type = 'end' then coalesce(ps.ended_at, now()) else ps.ended_at end,
            status = case when v_type = 'end' then 'ended' else ps.status end,
            updated_at = now()
        where ps.id = v_session.id;
      else
        -- Report arrived without a recorded start (e.g. start was lost). Create
        -- the row keyed by the same client_session_id and count it once.
        v_increment := least(c_increment_cap, v_seconds);
        insert into public.playtime_sessions (
          client_session_id, minecraft_uuid, minecraft_username, server_id, server_group,
          joined_at, last_seen_at, duration_seconds, ended_at, status
        ) values (
          v_session_id, v_uuid, v_username, p_server_id, v_group,
          now() - make_interval(secs => v_seconds), now(), v_seconds,
          case when v_type = 'end' then now() else null end,
          case when v_type = 'end' then 'ended' else 'active' end
        )
        on conflict (client_session_id) do nothing;
      end if;

      if v_increment > 0 then
        perform public._add_playtime_total(v_uuid, v_group, v_username, v_increment);
        perform public._add_playtime_total(v_uuid, 'all', v_username, v_increment);
      end if;
      v_applied := v_applied + 1;
    end if;
  end loop;

  applied_events := v_applied;
  reconciled_sessions := v_reconciled;
  return next;
end;
$$;

create or replace function public.playtime_leaderboard(
  p_server_group text default 'all',
  p_limit integer default 10
)
returns table(
  minecraft_uuid text,
  minecraft_username text,
  total_seconds bigint,
  rank integer
)
language sql
security definer
set search_path = public
as $$
  select
    pt.minecraft_uuid,
    pt.minecraft_username,
    pt.total_seconds,
    (row_number() over (order by pt.total_seconds desc))::integer as rank
  from public.playtime_totals pt
  where pt.server_group = coalesce(nullif(p_server_group, ''), 'all')
    and pt.total_seconds > 0
  order by pt.total_seconds desc
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
$$;

create or replace function public.close_stale_playtime_sessions(
  p_timeout_seconds integer default 600
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.playtime_sessions ps
  set status = 'stale', ended_at = ps.last_seen_at, updated_at = now()
  where ps.status = 'active'
    and ps.last_seen_at < now() - make_interval(secs => greatest(60, coalesce(p_timeout_seconds, 600)));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Grants: only service_role (the website API) may call these.
revoke all on function public.apply_playtime_events(text, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.apply_playtime_events(text, text, boolean, jsonb) to service_role;

revoke all on function public.playtime_leaderboard(text, integer) from public, anon, authenticated;
grant execute on function public.playtime_leaderboard(text, integer) to service_role;

revoke all on function public.close_stale_playtime_sessions(integer) from public, anon, authenticated;
grant execute on function public.close_stale_playtime_sessions(integer) to service_role;
