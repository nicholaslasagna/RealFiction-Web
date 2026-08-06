-- Transactional email delivery tracking + Stripe receipt reference.
--
-- Two distinct concepts per paid order:
--   1. The Stripe payment receipt (Stripe sends it; we store the URL).
--   2. The RealFiction fulfilment email (we send it; tracked here).
--
-- Sending email is a side effect of a payment we have ALREADY accepted, so this
-- table exists to make that side effect durable and idempotent: a send is
-- claimed before it is attempted, failures are recorded with a retry schedule,
-- and a webhook replay can never produce a second email.

-- ---------------------------------------------------------------------------
-- 1. Stripe receipt reference on the order
-- ---------------------------------------------------------------------------
-- Stripe hosts the receipt; we keep the URL so the account page and our own
-- fulfilment email can link to it. Nullable: Stripe only produces one for a
-- settled charge, and never for a failed or unpaid order.
alter table public.orders add column if not exists stripe_receipt_url text;

-- ---------------------------------------------------------------------------
-- 2. Email delivery ledger
-- ---------------------------------------------------------------------------
create table if not exists public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  -- Deterministic per (purpose, subject-entity). This is THE dedupe key: e.g.
  -- 'order_confirmation:<order_id>'. A webhook replay recomputes the same key
  -- and loses the insert race.
  idempotency_key text not null,
  template text not null,
  recipient text not null,
  order_id uuid references public.orders(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error text,
  provider_message_id text,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create unique index if not exists email_deliveries_idempotency_idx
on public.email_deliveries(idempotency_key);

create index if not exists email_deliveries_retry_idx
on public.email_deliveries(status, next_attempt_at)
where status = 'failed';

create index if not exists email_deliveries_order_idx
on public.email_deliveries(order_id, created_at desc);

alter table public.email_deliveries enable row level security;
-- No policies: service-role only. Recipient addresses are personal data and are
-- never client-readable.

/**
 * Claims the right to send one email.
 *
 * Returns true only for the caller that should actually send. A row already
 * 'sent' returns false (never a duplicate). A 'failed' row is re-claimable once
 * its backoff has elapsed, so a retry pass can pick it up.
 */
create or replace function public.claim_email_delivery(
  p_idempotency_key text,
  p_template text,
  p_recipient text,
  p_order_id uuid default null
)
returns table(delivery_id uuid, should_send boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.email_deliveries%rowtype;
begin
  insert into public.email_deliveries (idempotency_key, template, recipient, order_id, attempts)
  values (p_idempotency_key, p_template, p_recipient, p_order_id, 1)
  on conflict (idempotency_key) do nothing
  returning * into v_row;

  if found then
    delivery_id := v_row.id;
    should_send := true;
    return next;
    return;
  end if;

  -- Existing row: lock it so two concurrent retries cannot both send.
  select * into v_row
  from public.email_deliveries
  where public.email_deliveries.idempotency_key = p_idempotency_key
  for update;

  if v_row.status = 'sent' or v_row.status = 'skipped' then
    delivery_id := v_row.id;
    should_send := false;
    return next;
    return;
  end if;

  -- A failed row is claimable ONLY once its backoff has elapsed. A null
  -- next_attempt_at means parked for good (permanent rejection, or retries
  -- exhausted) — never "retry immediately".
  if v_row.status = 'failed'
     and (v_row.next_attempt_at is null or v_row.next_attempt_at > now()) then
    delivery_id := v_row.id;
    should_send := false;
    return next;
    return;
  end if;

  update public.email_deliveries
  set attempts = public.email_deliveries.attempts + 1,
      status = 'pending'
  where public.email_deliveries.id = v_row.id;

  delivery_id := v_row.id;
  should_send := true;
  return next;
end;
$$;

revoke all on function public.claim_email_delivery(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_email_delivery(text, text, text, uuid) to service_role;

/** Marks a delivery sent. Terminal. */
create or replace function public.mark_email_sent(
  p_delivery_id uuid,
  p_provider_message_id text default null
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
      last_error = null,
      next_attempt_at = null
  where id = p_delivery_id;
$$;

revoke all on function public.mark_email_sent(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_email_sent(uuid, text) to service_role;

/**
 * Records a failure. `p_retryable = false` (bad address, provider rejection)
 * parks the row with no next attempt so it stops consuming retries; a retryable
 * failure gets exponential backoff capped at ~1 hour.
 */
create or replace function public.mark_email_failed(
  p_delivery_id uuid,
  p_error text,
  p_retryable boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
begin
  select attempts into v_attempts
  from public.email_deliveries
  where id = p_delivery_id;

  update public.email_deliveries
  set status = 'failed',
      last_error = left(coalesce(p_error, 'unknown'), 200),
      next_attempt_at = case
        when not p_retryable then null
        when coalesce(v_attempts, 1) >= 6 then null  -- give up after 6 tries
        else now() + make_interval(secs => least(3600, power(4, coalesce(v_attempts, 1))::int * 15))
      end
  where id = p_delivery_id;
end;
$$;

revoke all on function public.mark_email_failed(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.mark_email_failed(uuid, text, boolean) to service_role;
