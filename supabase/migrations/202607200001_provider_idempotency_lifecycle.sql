-- Provider-idempotency lifecycle.
--
-- Resend honours an Idempotency-Key for ~24 HOURS. Reusing the key past that
-- window does not deduplicate — it creates a second send. So "the same key makes
-- a retry safe" is true only inside a bounded window, and the system must say so
-- explicitly rather than imply global exactly-once delivery.
--
-- Policy: the FIRST outbound Resend request opens a 23-hour window (a deliberate
-- safety margin under the documented 24h). Every retry inside that window reuses
-- the same key, so Resend suppresses duplicates. Once the window closes, an
-- unresolved delivery is NEVER retried automatically — it becomes
-- delivery_uncertain and waits for a human, because we cannot prove whether the
-- original request was accepted and a fresh key could double-send.
--
-- Normal retries finish far inside the window: backoff caps at 1h and attempts
-- cap at 8, so a delivery exhausts its budget in ~4-5 hours. The deadline only
-- engages during a genuine multi-hour outage.

-- ---------------------------------------------------------------------------
-- 1. Lifecycle columns
-- ---------------------------------------------------------------------------
-- Set ONLY when an actual provider request is dispatched. A missing API key or
-- an unrenderable row never sets this, so a delivery that never reached Resend
-- has no deadline and stays recoverable indefinitely.
alter table public.email_deliveries add column if not exists first_provider_attempt_at timestamptz;
alter table public.email_deliveries add column if not exists provider_idempotency_expires_at timestamptz;
alter table public.email_deliveries add column if not exists last_provider_status integer;
alter table public.email_deliveries add column if not exists last_safe_error_category text;

-- Manual resend lineage: a resend is a NEW delivery identity, never a mutation
-- of the original. This keeps the audit trail intact.
alter table public.email_deliveries add column if not exists resend_of uuid references public.email_deliveries(id) on delete set null;
alter table public.email_deliveries add column if not exists resend_seq integer not null default 0;
alter table public.email_deliveries add column if not exists resend_requested_by text;

-- One authoritative state column. `status` carried only a subset of the states
-- the lifecycle needs; delivery_outcome replaces it outright rather than living
-- alongside it, so there is never a question of which one is true.
alter table public.email_deliveries add column if not exists delivery_outcome text;

-- Backfill guarded on `status` still existing, so this migration stays
-- re-runnable (every other migration in this repo is, and it is re-applied
-- during testing). Without the guard a second run errors on a dropped column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'email_deliveries' and column_name = 'status'
  ) then
    update public.email_deliveries
    set delivery_outcome = case status
      when 'sent' then 'sent'
      when 'processing' then 'processing'
      when 'unconfigured' then 'unconfigured'
      when 'failed' then case when next_attempt_at is null then 'failed_permanent' else 'failed_retryable' end
      when 'skipped' then 'failed_permanent'
      else 'pending'
    end
    where delivery_outcome is null;
  end if;
end
$$;

update public.email_deliveries set delivery_outcome = 'pending' where delivery_outcome is null;

alter table public.email_deliveries alter column delivery_outcome set default 'pending';
alter table public.email_deliveries alter column delivery_outcome set not null;

alter table public.email_deliveries drop constraint if exists email_deliveries_status_check;
alter table public.email_deliveries drop column if exists status;

alter table public.email_deliveries drop constraint if exists email_deliveries_outcome_check;
alter table public.email_deliveries
  add constraint email_deliveries_outcome_check
  check (delivery_outcome in (
    'pending', 'processing', 'sent',
    'failed_retryable', 'failed_permanent',
    'delivery_uncertain', 'unconfigured'
  ));

drop index if exists email_deliveries_due_idx;
drop index if exists email_deliveries_lease_idx;
drop index if exists email_deliveries_retry_idx;

create index if not exists email_deliveries_due_idx
on public.email_deliveries(delivery_outcome, next_attempt_at, created_at);

create index if not exists email_deliveries_window_idx
on public.email_deliveries(provider_idempotency_expires_at)
where provider_idempotency_expires_at is not null;

/** Safety margin under Resend's ~24h idempotency-key retention. */
create or replace function public.provider_idempotency_window()
returns interval language sql immutable as $$ select interval '23 hours' $$;

-- ---------------------------------------------------------------------------
-- 2. Enqueue (unchanged contract, new state column)
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_email_delivery(
  p_idempotency_key text,
  p_template text,
  p_recipient text,
  p_order_id uuid default null,
  p_params jsonb default '{}'::jsonb
)
returns table(delivery_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.email_deliveries (
    idempotency_key, template, recipient, order_id, params, delivery_outcome, attempts, next_attempt_at
  )
  values (p_idempotency_key, p_template, p_recipient, p_order_id, coalesce(p_params, '{}'::jsonb), 'pending', 0, now())
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is not null then
    delivery_id := v_id;
    created := true;
    return next;
    return;
  end if;

  select id into v_id
  from public.email_deliveries
  where public.email_deliveries.idempotency_key = p_idempotency_key;

  delivery_id := v_id;
  created := false;
  return next;
end;
$$;

revoke all on function public.enqueue_email_delivery(text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_email_delivery(text, text, text, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Expire stale provider windows
-- ---------------------------------------------------------------------------
/**
 * Any unresolved delivery whose provider-idempotency window has closed becomes
 * delivery_uncertain: we cannot prove whether Resend accepted the original
 * request, and retrying with a fresh key could deliver a second copy. A human
 * decides, via an explicit manual resend.
 */
create or replace function public.expire_email_idempotency_windows()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.email_deliveries
  set delivery_outcome = 'delivery_uncertain',
      last_safe_error_category = coalesce(last_safe_error_category, 'idempotency_window_expired'),
      locked_until = null,
      locked_by = null,
      next_attempt_at = null
  where delivery_outcome in ('processing', 'failed_retryable', 'pending')
    and first_provider_attempt_at is not null
    and provider_idempotency_expires_at is not null
    and provider_idempotency_expires_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_email_idempotency_windows() from public, anon, authenticated;
grant execute on function public.expire_email_idempotency_windows() to service_role;

-- ---------------------------------------------------------------------------
-- 4. Claim a batch
-- ---------------------------------------------------------------------------
/**
 * Leases due deliveries, after first retiring any whose provider window closed.
 *
 * Never returns sent, failed_permanent, or delivery_uncertain rows, and never
 * returns a row whose provider deadline has passed — that is the guarantee that
 * a post-deadline retry calls Resend zero times.
 */
create or replace function public.claim_due_email_deliveries(
  p_limit integer default 20,
  p_lease_seconds integer default 120,
  p_worker text default null
)
returns setof public.email_deliveries
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.expire_email_idempotency_windows();

  return query
  with due as (
    select d.id
    from public.email_deliveries d
    where d.attempts < public.email_delivery_max_attempts()
      -- A closed provider window is disqualifying regardless of state.
      and (d.provider_idempotency_expires_at is null or d.provider_idempotency_expires_at > now())
      and (
        (d.delivery_outcome in ('pending', 'unconfigured')
          and (d.next_attempt_at is null or d.next_attempt_at <= now()))
        or (d.delivery_outcome = 'failed_retryable'
          and d.next_attempt_at is not null and d.next_attempt_at <= now())
        or (d.delivery_outcome = 'processing'
          and d.locked_until is not null and d.locked_until <= now())
      )
    order by d.created_at
    limit greatest(1, p_limit)
    for update skip locked
  )
  update public.email_deliveries e
  set delivery_outcome = 'processing',
      attempts = e.attempts + 1,
      locked_until = now() + make_interval(secs => greatest(30, p_lease_seconds)),
      locked_by = p_worker
  from due
  where e.id = due.id
  returning e.*;
end;
$$;

revoke all on function public.claim_due_email_deliveries(integer, integer, text) from public, anon, authenticated;
grant execute on function public.claim_due_email_deliveries(integer, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Open the provider window
-- ---------------------------------------------------------------------------
/**
 * Called immediately BEFORE the first outbound Resend request for a delivery.
 * Idempotent: a later attempt does not move the deadline, so the window is
 * measured from the genuine first dispatch.
 */
create or replace function public.begin_email_provider_attempt(p_delivery_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expires timestamptz;
begin
  update public.email_deliveries
  set first_provider_attempt_at = coalesce(first_provider_attempt_at, now()),
      provider_idempotency_expires_at = coalesce(
        provider_idempotency_expires_at,
        now() + public.provider_idempotency_window()
      )
  where id = p_delivery_id
  returning provider_idempotency_expires_at into v_expires;

  return v_expires;
end;
$$;

revoke all on function public.begin_email_provider_attempt(uuid) from public, anon, authenticated;
grant execute on function public.begin_email_provider_attempt(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Outcomes
-- ---------------------------------------------------------------------------
create or replace function public.mark_email_sent(
  p_delivery_id uuid,
  p_provider_message_id text default null,
  p_provider_status_code integer default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.email_deliveries
  set delivery_outcome = 'sent',
      sent_at = now(),
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      provider_status_code = coalesce(p_provider_status_code, provider_status_code),
      last_provider_status = coalesce(p_provider_status_code, last_provider_status),
      last_safe_error_category = 'accepted',
      diagnostic_category = 'accepted',
      last_error = null,
      next_attempt_at = null,
      locked_until = null,
      locked_by = null
  where id = p_delivery_id;
$$;

revoke all on function public.mark_email_sent(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.mark_email_sent(uuid, text, integer) to service_role;

create or replace function public.mark_email_failed(
  p_delivery_id uuid,
  p_error text,
  p_retryable boolean default true,
  p_provider_status_code integer default null,
  p_diagnostic_category text default null,
  p_retry_after_seconds integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
  v_window_ends timestamptz;
  v_backoff numeric;
  v_next timestamptz;
begin
  select attempts, provider_idempotency_expires_at
  into v_attempts, v_window_ends
  from public.email_deliveries
  where id = p_delivery_id;

  v_attempts := coalesce(v_attempts, 1);
  v_backoff := least(3600, 15 * power(2, greatest(0, v_attempts - 1)));
  v_backoff := v_backoff * (0.75 + random() * 0.5);

  if p_retry_after_seconds is not null and p_retry_after_seconds > 0 then
    v_backoff := greatest(v_backoff, p_retry_after_seconds);
  end if;

  v_next := now() + make_interval(secs => ceil(v_backoff)::integer);

  update public.email_deliveries
  set delivery_outcome = case
        when not p_retryable then 'failed_permanent'
        when v_attempts >= public.email_delivery_max_attempts() then 'failed_permanent'
        -- The next retry would land outside the provider window, where the key
        -- no longer deduplicates. Stop and escalate instead of risking a double.
        when v_window_ends is not null and v_next >= v_window_ends then 'delivery_uncertain'
        else 'failed_retryable'
      end,
      last_error = left(coalesce(p_error, 'unknown'), 200),
      provider_status_code = coalesce(p_provider_status_code, provider_status_code),
      last_provider_status = coalesce(p_provider_status_code, last_provider_status),
      diagnostic_category = coalesce(p_diagnostic_category, diagnostic_category),
      last_safe_error_category = coalesce(p_diagnostic_category, last_safe_error_category),
      locked_until = null,
      locked_by = null,
      next_attempt_at = case
        when not p_retryable then null
        when v_attempts >= public.email_delivery_max_attempts() then null
        when v_window_ends is not null and v_next >= v_window_ends then null
        else v_next
      end
  where id = p_delivery_id;
end;
$$;

revoke all on function public.mark_email_failed(uuid, text, boolean, integer, text, integer) from public, anon, authenticated;
grant execute on function public.mark_email_failed(uuid, text, boolean, integer, text, integer) to service_role;

/**
 * The outcome could not be determined (dispatch timeout, connection closed with
 * no definitive response, or an accepted response we failed to persist).
 *
 * While the provider window is still open this stays retryable — replaying the
 * SAME key is safe and is exactly what resolves it. Once the window closes it
 * becomes delivery_uncertain.
 */
create or replace function public.mark_email_uncertain(
  p_delivery_id uuid,
  p_category text default 'ambiguous_dispatch'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_ends timestamptz;
  v_attempts integer;
begin
  select provider_idempotency_expires_at, attempts
  into v_window_ends, v_attempts
  from public.email_deliveries
  where id = p_delivery_id;

  update public.email_deliveries
  set delivery_outcome = case
        when v_window_ends is null or v_window_ends <= now() then 'delivery_uncertain'
        when coalesce(v_attempts, 1) >= public.email_delivery_max_attempts() then 'delivery_uncertain'
        else 'failed_retryable'
      end,
      last_safe_error_category = p_category,
      diagnostic_category = p_category,
      last_error = p_category,
      locked_until = null,
      locked_by = null,
      -- Retry promptly: the window is finite and the same key still suppresses
      -- duplicates, so resolving quickly is strictly better than backing off.
      next_attempt_at = case
        when v_window_ends is null or v_window_ends <= now() then null
        when coalesce(v_attempts, 1) >= public.email_delivery_max_attempts() then null
        else now() + interval '30 seconds'
      end
  where id = p_delivery_id;
end;
$$;

revoke all on function public.mark_email_uncertain(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_email_uncertain(uuid, text) to service_role;

create or replace function public.mark_email_unconfigured(
  p_delivery_id uuid,
  p_retry_seconds integer default 300
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.email_deliveries
  set delivery_outcome = 'unconfigured',
      attempts = greatest(0, attempts - 1),
      diagnostic_category = 'not_configured',
      last_safe_error_category = 'not_configured',
      last_error = 'email_not_configured',
      locked_until = null,
      locked_by = null,
      next_attempt_at = now() + make_interval(secs => greatest(60, p_retry_seconds))
  where id = p_delivery_id
    -- No provider request was made, so no window is opened and the delivery
    -- stays recoverable however long the binding is missing.
    and first_provider_attempt_at is null;
$$;

revoke all on function public.mark_email_unconfigured(uuid, integer) from public, anon, authenticated;
grant execute on function public.mark_email_unconfigured(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Manual resend
-- ---------------------------------------------------------------------------
/**
 * An explicit human-requested resend. Creates a NEW delivery with a NEW
 * operation identity (`<key>:resend:<n>`) and its own fresh provider window —
 * never a mutation or reuse of the original, whose audit record stays intact.
 */
create or replace function public.request_email_resend(
  p_original_delivery_id uuid,
  p_requested_by text
)
returns table(delivery_id uuid, new_idempotency_key text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.email_deliveries%rowtype;
  v_seq integer;
  v_key text;
  v_id uuid;
begin
  select * into v_original
  from public.email_deliveries
  where id = p_original_delivery_id;

  if not found then
    raise exception 'Delivery % not found', p_original_delivery_id;
  end if;

  select coalesce(max(resend_seq), 0) + 1 into v_seq
  from public.email_deliveries
  where resend_of = coalesce(v_original.resend_of, v_original.id)
     or id = coalesce(v_original.resend_of, v_original.id);

  -- Always derived from the ROOT delivery's key, so resending a resend still
  -- yields "<root-key>:resend:<n>" rather than compounding suffixes.
  v_key := regexp_replace(v_original.idempotency_key, ':resend:[0-9]+$', '') || ':resend:' || v_seq::text;

  insert into public.email_deliveries (
    idempotency_key, template, recipient, order_id, params,
    delivery_outcome, attempts, next_attempt_at,
    resend_of, resend_seq, resend_requested_by
  )
  values (
    v_key, v_original.template, v_original.recipient, v_original.order_id, v_original.params,
    'pending', 0, now(),
    coalesce(v_original.resend_of, v_original.id), v_seq, p_requested_by
  )
  returning id into v_id;

  delivery_id := v_id;
  new_idempotency_key := v_key;
  return next;
end;
$$;

revoke all on function public.request_email_resend(uuid, text) from public, anon, authenticated;
grant execute on function public.request_email_resend(uuid, text) to service_role;
