-- Fix RealCore reward acknowledgement: SQLSTATE 42702
-- "column reference \"delivered_at\" is ambiguous".
--
-- Root cause: the function's RETURNS TABLE columns (reward_id, status,
-- delivered_at, failed_at) had the SAME names as reward_queue columns. Inside the
-- UPDATE, an unqualified reference such as `coalesce(delivered_at, now())` could
-- mean either the OUT column or the table column, so Postgres raised 42702 and
-- the row never transitioned out of 'processing'.
--
-- This recreates the function with:
--   * RETURNS TABLE columns renamed to ack_* so they cannot collide with any
--     reward_queue column or function parameter.
--   * EVERY reward_queue reference fully qualified through the `rq` alias.
--   * a successful/failed ack clearing the claim fields (processing_at,
--     claimed_at, claimed_by_server) alongside the terminal status.
--
-- Idempotent (already-final rewards report and stop), duplicate-safe (ownership
-- guard), and enum-safe (p_status is public.reward_status). Non-destructive.

drop function if exists public.ack_reward_delivery(uuid, text, public.reward_status, text);

create or replace function public.ack_reward_delivery(
  p_reward_id uuid,
  p_server_id text,
  p_status public.reward_status,
  p_failure_reason text default null
)
returns table(
  ack_reward_id uuid,
  ack_status public.reward_status,
  ack_delivered_at timestamptz,
  ack_failed_at timestamptz,
  ack_already_final boolean
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

  select rq.*
  into v_reward
  from public.reward_queue rq
  where rq.id = p_reward_id
  for update;

  if not found then
    raise exception 'Reward % not found', p_reward_id;
  end if;

  -- Ownership guard: a server may only acknowledge rewards it claimed.
  if v_reward.claimed_by_server is not null and v_reward.claimed_by_server <> p_server_id then
    raise exception 'Reward % is claimed by another server', p_reward_id;
  end if;

  -- Idempotent + duplicate-safe: already finalized -> report and stop.
  if v_reward.status in ('delivered', 'failed') then
    ack_reward_id := v_reward.id;
    ack_status := v_reward.status;
    ack_delivered_at := v_reward.delivered_at;
    ack_failed_at := v_reward.failed_at;
    ack_already_final := true;
    return next;
    return;
  end if;

  if p_status = 'delivered' then
    update public.reward_queue rq
    set status = 'delivered',
        delivered_at = coalesce(rq.delivered_at, now()),
        failed_at = null,
        failure_reason = null,
        last_error = null,
        processing_at = null,
        claimed_at = null,
        claimed_by_server = null
    where rq.id = p_reward_id
    returning rq.id, rq.status, rq.delivered_at, rq.failed_at
    into ack_reward_id, ack_status, ack_delivered_at, ack_failed_at;
  else
    update public.reward_queue rq
    set status = 'failed',
        failed_at = coalesce(rq.failed_at, now()),
        failure_reason = coalesce(nullif(p_failure_reason, ''), 'Plugin reported delivery failure.'),
        last_error = coalesce(nullif(p_failure_reason, ''), 'Plugin reported delivery failure.'),
        processing_at = null,
        claimed_at = null,
        claimed_by_server = null
    where rq.id = p_reward_id
    returning rq.id, rq.status, rq.delivered_at, rq.failed_at
    into ack_reward_id, ack_status, ack_delivered_at, ack_failed_at;
  end if;

  ack_already_final := false;
  return next;
end;
$$;

revoke all on function public.ack_reward_delivery(uuid, text, public.reward_status, text) from public;
revoke all on function public.ack_reward_delivery(uuid, text, public.reward_status, text) from anon;
revoke all on function public.ack_reward_delivery(uuid, text, public.reward_status, text) from authenticated;
grant execute on function public.ack_reward_delivery(uuid, text, public.reward_status, text) to service_role;
