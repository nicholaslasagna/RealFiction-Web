-- RealCore multi-server hardening.
--
-- Prepares reward delivery for a network where RealCore runs on many backends
-- (lobby, arcade, smp, anarchy, factions) at once. All changes are additive and
-- backward compatible: existing rewards have target_server_id = null and
-- server_group = 'global', so they keep delivering exactly as they do today.
--
-- 1) Per-server targeting (target_server_id) on top of the existing group
--    targeting (server_group).
-- 2) Stale-claim reclaim: a reward stuck in 'processing' (e.g. a backend crashed
--    after claiming) is reclaimable after a visibility timeout, giving safe
--    at-least-once retry without losing the existing atomic single-claim guard.
-- 3) A lightweight server registry + heartbeat so two backends accidentally
--    sharing a serverId can be detected.

-- 1) Per-server targeting -----------------------------------------------------
alter table public.reward_queue
  add column if not exists target_server_id text;

create index if not exists reward_queue_dispatch_idx
  on public.reward_queue (status, server_group, available_at);

create index if not exists reward_queue_target_server_idx
  on public.reward_queue (target_server_id)
  where target_server_id is not null;

-- 2) Atomic claim + stale reclaim --------------------------------------------
-- Same RETURNS shape and signature as before (callers unchanged). Adds the
-- target_server_id filter and reclaims rewards stuck in 'processing' past a
-- 5-minute visibility timeout (bounded by attempts to avoid poison-pill loops).
create or replace function public.poll_reward_queue(
  p_server_id text,
  p_server_group text default 'global',
  p_limit integer default 25
)
returns table(
  reward_id uuid,
  source text,
  reward_key text,
  minecraft_uuid text,
  minecraft_username text,
  server_group text,
  attempts integer,
  payload jsonb,
  entitlement_key text,
  entitlement_expires_at timestamptz,
  entitlement_status text,
  available_at timestamptz,
  processing_at timestamptz,
  claimed_at timestamptz,
  claimed_by_server text
)
language sql
security definer
set search_path = public
as $$
  with picked as (
    select id
    from public.reward_queue
    where (target_server_id is null or target_server_id = p_server_id)
      and (server_group = 'global' or server_group = p_server_group)
      and (
        (status = 'pending' and available_at <= now())
        or (
          status = 'processing'
          and processing_at is not null
          and processing_at < now() - interval '5 minutes'
          and attempts < 25
        )
      )
    order by available_at asc, created_at asc
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
    for update skip locked
  ),
  updated as (
    update public.reward_queue rq
    set status = 'processing',
        processing_at = now(),
        claimed_at = now(),
        claimed_by_server = p_server_id,
        attempts = rq.attempts + 1,
        last_error = case
          when rq.status = 'processing' then 'Reclaimed after stale processing timeout'
          else null
        end
    from picked
    where rq.id = picked.id
      and rq.status in ('pending', 'processing')
    returning rq.*
  )
  select
    updated.id as reward_id,
    updated.source::text,
    updated.reward_key,
    updated.minecraft_uuid,
    updated.minecraft_username,
    updated.server_group,
    updated.attempts,
    updated.payload,
    entitlements.entitlement_key,
    entitlements.expires_at as entitlement_expires_at,
    entitlements.status::text as entitlement_status,
    updated.available_at,
    updated.processing_at,
    updated.claimed_at,
    updated.claimed_by_server
  from updated
  left join public.entitlements
    on updated.source = 'store'
   and entitlements.order_item_id = updated.source_id;
$$;

-- 3) Server registry + heartbeat ---------------------------------------------
create table if not exists public.plugin_servers (
  server_id text primary key,
  instance_id text not null,
  server_group text,
  display_name text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.plugin_servers enable row level security;

create index if not exists plugin_servers_last_seen_idx
  on public.plugin_servers (last_seen_at);

-- Records a backend's liveness and detects a second backend using the same
-- serverId. A different instance is only treated as a conflict while the
-- current owner is still fresh (last_seen within 60s), so a clean restart that
-- releases its row, or a crashed owner that goes stale, can take the id back.
create or replace function public.heartbeat_plugin_server(
  p_server_id text,
  p_instance_id text,
  p_server_group text default null,
  p_display_name text default null,
  p_release boolean default false
)
returns table(conflict boolean, active_instance text, active_since timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.plugin_servers%rowtype;
begin
  if p_server_id is null or p_instance_id is null then
    raise exception 'server_id and instance_id are required';
  end if;

  if p_release then
    delete from public.plugin_servers
    where server_id = p_server_id and instance_id = p_instance_id;
    conflict := false;
    active_instance := null;
    active_since := null;
    return next;
    return;
  end if;

  select * into v_row from public.plugin_servers where server_id = p_server_id for update;

  if found
     and v_row.instance_id <> p_instance_id
     and v_row.last_seen_at > now() - interval '60 seconds' then
    conflict := true;
    active_instance := v_row.instance_id;
    active_since := v_row.created_at;
    return next;
    return;
  end if;

  insert into public.plugin_servers (server_id, instance_id, server_group, display_name, last_seen_at)
  values (p_server_id, p_instance_id, p_server_group, p_display_name, now())
  on conflict (server_id) do update set
    instance_id = excluded.instance_id,
    server_group = excluded.server_group,
    display_name = excluded.display_name,
    last_seen_at = now();

  conflict := false;
  active_instance := p_instance_id;
  active_since := now();
  return next;
end;
$$;

revoke all on function public.heartbeat_plugin_server(text, text, text, text, boolean) from public;
revoke all on function public.heartbeat_plugin_server(text, text, text, text, boolean) from anon;
revoke all on function public.heartbeat_plugin_server(text, text, text, text, boolean) from authenticated;
grant execute on function public.heartbeat_plugin_server(text, text, text, text, boolean) to service_role;

drop policy if exists "plugin_servers_admin_write" on public.plugin_servers;

create policy "plugin_servers_admin_write"
on public.plugin_servers for all
using (public.is_admin())
with check (public.is_admin());
