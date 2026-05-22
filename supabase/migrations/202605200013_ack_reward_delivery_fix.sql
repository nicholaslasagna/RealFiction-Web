-- Fix RealCore reward acknowledgement (rewards stuck in 'processing').
--
-- Symptom: ack_reward_delivery fails at the PostgREST resolution layer (the row
-- stays status='processing' with last_error untouched, i.e. the function body
-- never ran), which left vote rewards stuck and caused duplicate delivery when
-- the stale-claim reclaim re-polled them. poll_reward_queue (one signature) works
-- fine, which points at an ambiguous ack_reward_delivery: an older
-- (uuid, text, text, text) overload coexisting with the enum-typed version makes
-- PostgREST unable to choose a candidate.
--
-- This removes any stale text-status overload and re-asserts the canonical
-- enum-status function so exactly one signature exists. Idempotent, backward
-- compatible, non-destructive to data.

drop function if exists public.ack_reward_delivery(uuid, text, text, text);

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

revoke all on function public.ack_reward_delivery(uuid, text, public.reward_status, text) from public;
revoke all on function public.ack_reward_delivery(uuid, text, public.reward_status, text) from anon;
revoke all on function public.ack_reward_delivery(uuid, text, public.reward_status, text) from authenticated;
grant execute on function public.ack_reward_delivery(uuid, text, public.reward_status, text) to service_role;
