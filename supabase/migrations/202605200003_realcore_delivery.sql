alter table public.reward_queue
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by_server text,
  add column if not exists last_error text;

create index if not exists reward_queue_claimed_by_server_idx
on public.reward_queue(claimed_by_server, status);

create table if not exists public.plugin_request_nonces (
  nonce_hash text primary key,
  server_id text not null,
  route text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.plugin_request_nonces enable row level security;

create index if not exists plugin_request_nonces_expires_at_idx
on public.plugin_request_nonces(expires_at);

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
    where status = 'pending'
      and available_at <= now()
      and (server_group = 'global' or server_group = p_server_group)
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
        last_error = null
    from picked
    where rq.id = picked.id
      and rq.status = 'pending'
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

create or replace function public.ack_reward_delivery(
  p_reward_id uuid,
  p_server_id text,
  p_status public.reward_status,
  p_failure_reason text default null
)
returns table(
  reward_id uuid,
  status public.reward_status,
  delivered_at timestamptz,
  failed_at timestamptz,
  already_final boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reward public.reward_queue%rowtype;
begin
  if p_status not in ('delivered', 'failed') then
    raise exception 'Unsupported acknowledgement status %', p_status;
  end if;

  select *
  into v_reward
  from public.reward_queue
  where id = p_reward_id
  for update;

  if not found then
    raise exception 'Reward % not found', p_reward_id;
  end if;

  if v_reward.claimed_by_server is not null and v_reward.claimed_by_server <> p_server_id then
    raise exception 'Reward % is claimed by another server', p_reward_id;
  end if;

  if v_reward.status in ('delivered', 'failed') then
    reward_id := v_reward.id;
    status := v_reward.status;
    delivered_at := v_reward.delivered_at;
    failed_at := v_reward.failed_at;
    already_final := true;
    return next;
    return;
  end if;

  if p_status = 'delivered' then
    update public.reward_queue
    set status = 'delivered',
        delivered_at = coalesce(delivered_at, now()),
        failed_at = null,
        failure_reason = null,
        last_error = null
    where id = p_reward_id
    returning id, reward_queue.status, reward_queue.delivered_at, reward_queue.failed_at
    into reward_id, status, delivered_at, failed_at;
  else
    update public.reward_queue
    set status = 'failed',
        failed_at = coalesce(failed_at, now()),
        failure_reason = coalesce(nullif(p_failure_reason, ''), 'Plugin reported delivery failure.'),
        last_error = coalesce(nullif(p_failure_reason, ''), 'Plugin reported delivery failure.')
    where id = p_reward_id
    returning id, reward_queue.status, reward_queue.delivered_at, reward_queue.failed_at
    into reward_id, status, delivered_at, failed_at;
  end if;

  already_final := false;
  return next;
end;
$$;

revoke all on function public.poll_reward_queue(text, text, integer) from public;
revoke all on function public.poll_reward_queue(text, text, integer) from anon;
revoke all on function public.poll_reward_queue(text, text, integer) from authenticated;
grant execute on function public.poll_reward_queue(text, text, integer) to service_role;

revoke all on function public.ack_reward_delivery(uuid, text, public.reward_status, text) from public;
revoke all on function public.ack_reward_delivery(uuid, text, public.reward_status, text) from anon;
revoke all on function public.ack_reward_delivery(uuid, text, public.reward_status, text) from authenticated;
grant execute on function public.ack_reward_delivery(uuid, text, public.reward_status, text) to service_role;

drop policy if exists "plugin_request_nonces_admin_write" on public.plugin_request_nonces;

create policy "plugin_request_nonces_admin_write"
on public.plugin_request_nonces for all
using (public.is_admin())
with check (public.is_admin());
