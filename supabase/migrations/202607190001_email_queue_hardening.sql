-- Email queue hardening: the webhook enqueues, a scheduled worker sends.
--
-- The Stripe webhook must never await a third-party HTTP call. It records a
-- durable delivery row inside the payment transaction and returns 2xx; a
-- Cloudflare Cron Trigger drains the queue out-of-band. That way a Resend
-- outage can never slow, fail, or retry a webhook that has already taken money.

-- ---------------------------------------------------------------------------
-- 1. Order-time snapshots
-- ---------------------------------------------------------------------------
-- The buyer's VERIFIED email at checkout time. Fulfilment mail must go to the
-- address that bought the order, not to whatever the profile says later — a
-- changed (or attacker-changed) profile email must not redirect an old receipt.
alter table public.orders add column if not exists buyer_email text;

-- Charge id, so receipt_url enrichment can happen later and out-of-band instead
-- of blocking the webhook on a Stripe read.
alter table public.orders add column if not exists stripe_charge_id text;

-- ---------------------------------------------------------------------------
-- 2. Delivery queue columns
-- ---------------------------------------------------------------------------
-- Render parameters that cannot be re-derived from the order at send time (a
-- refund amount, for example). Safe fields only: never tokens, codes, payment
-- instruments, or message bodies.
alter table public.email_deliveries add column if not exists params jsonb not null default '{}'::jsonb;

-- Lease: which worker holds this row and until when. An abandoned lease (worker
-- died mid-send) becomes claimable again after it expires.
alter table public.email_deliveries add column if not exists locked_until timestamptz;
alter table public.email_deliveries add column if not exists locked_by text;

-- Final provider response, kept for diagnosis. A status code and a short
-- category — never a response body.
alter table public.email_deliveries add column if not exists provider_status_code integer;
alter table public.email_deliveries add column if not exists diagnostic_category text;

alter table public.email_deliveries drop constraint if exists email_deliveries_status_check;
alter table public.email_deliveries
  add constraint email_deliveries_status_check
  check (status in ('pending', 'processing', 'sent', 'failed', 'skipped', 'unconfigured'));

create index if not exists email_deliveries_due_idx
on public.email_deliveries(status, next_attempt_at, created_at);

create index if not exists email_deliveries_lease_idx
on public.email_deliveries(locked_until)
where status = 'processing';

/** Attempts allowed before a delivery is parked for a human. */
create or replace function public.email_delivery_max_attempts()
returns integer language sql immutable as $$ select 8 $$;

-- ---------------------------------------------------------------------------
-- 3. Retire the superseded single-shot send API
-- ---------------------------------------------------------------------------
-- 202607180001 shipped a claim-then-send-inline API. This migration replaces it
-- with enqueue + leased batch claiming. The old signatures MUST be dropped, not
-- merely shadowed: leaving them creates overloads (e.g. mark_email_sent(uuid,
-- text) alongside mark_email_sent(uuid, text, integer default)), which makes an
-- ordinary two-argument call ambiguous and fails at runtime.
drop function if exists public.claim_email_delivery(text, text, text, uuid);
drop function if exists public.mark_email_sent(uuid, text);
drop function if exists public.mark_email_failed(uuid, text, boolean);

-- ---------------------------------------------------------------------------
-- 4. Enqueue (called by the webhook — never sends)
-- ---------------------------------------------------------------------------
/**
 * Records the intent to send. Idempotent on idempotency_key, so a replayed
 * Stripe event enqueues nothing new and can never produce a second email.
 */
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
    idempotency_key, template, recipient, order_id, params, status, attempts, next_attempt_at
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
-- 5. Claim a batch (called by the scheduled worker)
-- ---------------------------------------------------------------------------
/**
 * Atomically leases up to p_limit due deliveries.
 *
 * FOR UPDATE SKIP LOCKED means two concurrent scheduled executions never claim
 * the same row — the second simply skips it rather than blocking. Rows stuck in
 * 'processing' past their lease are reclaimed, which is how a worker that died
 * mid-send recovers.
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
  return query
  with due as (
    select d.id
    from public.email_deliveries d
    where d.attempts < public.email_delivery_max_attempts()
      and (
        -- never sent yet, or a config-missing row waiting for a binding
        (d.status in ('pending', 'unconfigured') and (d.next_attempt_at is null or d.next_attempt_at <= now()))
        -- a retryable failure whose backoff has elapsed
        or (d.status = 'failed' and d.next_attempt_at is not null and d.next_attempt_at <= now())
        -- an abandoned lease
        or (d.status = 'processing' and d.locked_until is not null and d.locked_until <= now())
      )
    order by d.created_at
    limit greatest(1, p_limit)
    for update skip locked
  )
  update public.email_deliveries e
  set status = 'processing',
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
-- 6. Terminal / retry outcomes
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
  set status = 'sent',
      sent_at = now(),
      provider_message_id = p_provider_message_id,
      provider_status_code = coalesce(p_provider_status_code, provider_status_code),
      diagnostic_category = 'accepted',
      last_error = null,
      next_attempt_at = null,
      locked_until = null,
      locked_by = null
  where id = p_delivery_id;
$$;

revoke all on function public.mark_email_sent(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.mark_email_sent(uuid, text, integer) to service_role;

/**
 * Records a failure and schedules (or refuses) a retry.
 *
 * Backoff is exponential with jitter so a provider outage does not produce a
 * synchronised retry stampede across workers. A provider Retry-After wins when
 * it asks for longer. A permanent rejection, or an exhausted attempt budget,
 * parks the row with next_attempt_at = null.
 */
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
  v_backoff numeric;
begin
  select attempts into v_attempts
  from public.email_deliveries
  where id = p_delivery_id;

  v_attempts := coalesce(v_attempts, 1);
  -- 15s, 30s, 60s ... capped at 1h, then +/-25% jitter.
  v_backoff := least(3600, 15 * power(2, greatest(0, v_attempts - 1)));
  v_backoff := v_backoff * (0.75 + random() * 0.5);

  if p_retry_after_seconds is not null and p_retry_after_seconds > 0 then
    v_backoff := greatest(v_backoff, p_retry_after_seconds);
  end if;

  update public.email_deliveries
  set status = 'failed',
      last_error = left(coalesce(p_error, 'unknown'), 200),
      provider_status_code = coalesce(p_provider_status_code, provider_status_code),
      diagnostic_category = coalesce(p_diagnostic_category, diagnostic_category),
      locked_until = null,
      locked_by = null,
      next_attempt_at = case
        when not p_retryable then null
        when v_attempts >= public.email_delivery_max_attempts() then null
        else now() + make_interval(secs => ceil(v_backoff)::integer)
      end
  where id = p_delivery_id;
end;
$$;

revoke all on function public.mark_email_failed(uuid, text, boolean, integer, text, integer) from public, anon, authenticated;
grant execute on function public.mark_email_failed(uuid, text, boolean, integer, text, integer) to service_role;

/**
 * The mail binding is not configured yet.
 *
 * This is an operator state, not a delivery failure: it must NEVER park the row
 * or consume the attempt budget, or a queue drained before RESEND_API_KEY was
 * added would be lost forever. The claim's attempt increment is rolled back and
 * the row simply waits.
 */
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
  set status = 'unconfigured',
      attempts = greatest(0, attempts - 1),
      diagnostic_category = 'not_configured',
      last_error = 'email_not_configured',
      locked_until = null,
      locked_by = null,
      next_attempt_at = now() + make_interval(secs => greatest(60, p_retry_seconds))
  where id = p_delivery_id;
$$;

revoke all on function public.mark_email_unconfigured(uuid, integer) from public, anon, authenticated;
grant execute on function public.mark_email_unconfigured(uuid, integer) to service_role;
