-- Stripe Phase 1 production readiness.
--
-- 1) Prepaid entitlements STACK instead of resetting to now() + duration.
-- 2) Checkout attempts are idempotent (two clicks -> one order) and durably
--    rate limited (Workers isolates cannot share process memory).
-- 3) Refund/dispute outcomes get an append-only audit trail, including the
--    manual-review cases we deliberately refuse to auto-apply.
--
-- Deliberately NOT changing public.order_status: `alter type ... add value`
-- cannot be used later in the same transaction, and every state we need is
-- already expressible ('cancelled' / 'refunded' / 'chargeback') with the detail
-- recorded in payment_reviews. Fewer moving parts, no enum migration hazard.

-- ---------------------------------------------------------------------------
-- 1. Entitlement stacking
-- ---------------------------------------------------------------------------
-- Same entitlement key for the same delivery target extends from the later of
-- (current expiry, now()). Buying 3 months with 10 days left yields 3 months and
-- 10 days, not 3 months. Idempotency is unchanged: the insert still relies on
-- `on conflict (order_item_id, entitlement_key) do nothing`, so a replayed
-- webhook recomputes an expiry but writes nothing and never extends twice.
create or replace function public.fulfill_paid_order(p_order_id uuid)
returns table(order_id uuid, created_entitlements integer, created_rewards integer, already_fulfilled boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_entitlement_key text;
  v_expires_at timestamptz;
  v_existing_expiry timestamptz;
  v_target_uuid text;
  v_target_username text;
  v_entitlements integer := 0;
  v_rewards integer := 0;
  v_rows integer := 0;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if v_order.status = 'fulfilled' then
    order_id := p_order_id;
    created_entitlements := 0;
    created_rewards := 0;
    already_fulfilled := true;
    return next;
    return;
  end if;

  if v_order.status not in ('paid', 'pending') then
    raise exception 'Order % is not fulfillable from status %', p_order_id, v_order.status;
  end if;

  update public.orders
  set status = 'paid',
      paid_at = coalesce(paid_at, now())
  where id = p_order_id;

  v_target_uuid := v_order.minecraft_uuid;
  v_target_username := coalesce(v_order.gifted_to_minecraft_username, v_order.minecraft_username);

  for v_item in
    select
      oi.id as order_item_id,
      oi.quantity,
      oi.product_snapshot,
      p.id as product_id,
      p.slug,
      p.category,
      p.name,
      p.fulfillment_type,
      p.duration_days,
      p.metadata
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id
  loop
    v_entitlement_key := 'product:' || v_item.slug;
    v_expires_at := null;

    if v_item.fulfillment_type = 'subscription' and v_item.duration_days is not null then
      -- Latest active expiry for this key on this target. Matched by UUID when
      -- we have one, else by username (gift orders carry no buyer UUID).
      -- Permanent (null-expiry) grants are ignored: they neither block nor
      -- absorb a timed purchase.
      select max(e.expires_at)
      into v_existing_expiry
      from public.entitlements e
      where e.entitlement_key = v_entitlement_key
        and e.status = 'active'
        and e.expires_at is not null
        and (
          (v_target_uuid is not null and e.minecraft_uuid = v_target_uuid)
          or (
            v_target_uuid is null
            and v_target_username is not null
            and lower(e.minecraft_username) = lower(v_target_username)
          )
        );

      v_expires_at := greatest(coalesce(v_existing_expiry, now()), now())
                      + make_interval(days => v_item.duration_days);
    end if;

    if v_item.fulfillment_type <> 'consumable' then
      insert into public.entitlements (
        user_id,
        minecraft_uuid,
        minecraft_username,
        product_id,
        order_item_id,
        entitlement_key,
        status,
        starts_at,
        expires_at,
        metadata
      )
      values (
        v_order.user_id,
        v_order.minecraft_uuid,
        v_target_username,
        v_item.product_id,
        v_item.order_item_id,
        v_entitlement_key,
        'active',
        now(),
        v_expires_at,
        jsonb_build_object(
          'source', 'order',
          'order_id', p_order_id,
          'product_slug', v_item.slug,
          'quantity', v_item.quantity,
          'gifted', v_order.gifted_to_minecraft_username is not null,
          'stacked_from', v_existing_expiry
        )
      )
      on conflict (order_item_id, entitlement_key) where order_item_id is not null do nothing;

      get diagnostics v_rows = row_count;
      v_entitlements := v_entitlements + v_rows;
    end if;

    if v_item.category <> 'gift_cards' then
      insert into public.reward_queue (
        user_id,
        minecraft_uuid,
        minecraft_username,
        source,
        source_id,
        reward_key,
        payload,
        idempotency_key,
        status,
        available_at
      )
      values (
        v_order.user_id,
        v_order.minecraft_uuid,
        v_target_username,
        'store',
        v_item.order_item_id,
        'store.' || v_item.slug,
        jsonb_build_object(
          'order_id', p_order_id,
          'order_item_id', v_item.order_item_id,
          'product_id', v_item.product_id,
          'product_slug', v_item.slug,
          'category', v_item.category,
          'fulfillment_type', v_item.fulfillment_type,
          'duration_days', v_item.duration_days,
          'quantity', v_item.quantity,
          'metadata', v_item.metadata,
          'expires_at', v_expires_at,
          'safe_reward', true
        ),
        'order_item:' || v_item.order_item_id::text,
        'pending',
        now()
      )
      on conflict (idempotency_key) do nothing;

      get diagnostics v_rows = row_count;
      v_rewards := v_rewards + v_rows;
    end if;
  end loop;

  update public.orders
  set status = 'fulfilled',
      fulfilled_at = coalesce(fulfilled_at, now())
  where id = p_order_id;

  order_id := p_order_id;
  created_entitlements := v_entitlements;
  created_rewards := v_rewards;
  already_fulfilled := false;
  return next;
end;
$$;

revoke all on function public.fulfill_paid_order(uuid) from public, anon, authenticated;
grant execute on function public.fulfill_paid_order(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Checkout attempts: idempotency + durable rate limiting
-- ---------------------------------------------------------------------------
-- Identity is the CLIENT-GENERATED attempt UUID, bound server-side to the
-- account + canonical cart fingerprint. A time bucket was considered and
-- rejected: clicks either side of a bucket boundary would mint two attempt
-- identities, two pending orders, and two payable Stripe sessions.
create table if not exists public.checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  attempt_id uuid not null,
  cart_fingerprint text not null,
  order_id uuid references public.orders(id) on delete set null,
  -- Bounded lifetime. Stripe prunes idempotency keys once they are ~24h old, so
  -- an unbounded attempt would eventually reuse a pruned key and mint a SECOND
  -- payable session. The attempt therefore dies with its Stripe session.
  attempt_expires_at timestamptz not null default now() + interval '1 hour',
  stripe_session_id text,
  stripe_session_url text,
  stripe_session_expires_at timestamptz,
  closed_at timestamptz,
  closed_reason text,
  created_at timestamptz not null default now()
);

-- One internal order per (account, attempt id), for the life of the attempt.
create unique index if not exists checkout_attempts_user_attempt_idx
on public.checkout_attempts(user_id, attempt_id);

-- THE active-cart lock. At most ONE live checkout per (account, canonical cart)
-- regardless of how many attempt UUIDs exist. This is what stops two tabs — or a
-- reload that lost its client-side id — from opening two payable sessions.
create unique index if not exists checkout_attempts_active_cart_idx
on public.checkout_attempts(user_id, cart_fingerprint)
where closed_at is null;

-- An order belongs to exactly one attempt, and an attempt to exactly one order.
create unique index if not exists checkout_attempts_order_idx
on public.checkout_attempts(order_id)
where order_id is not null;

-- A Stripe session is never shared between attempts.
create unique index if not exists checkout_attempts_session_idx
on public.checkout_attempts(stripe_session_id)
where stripe_session_id is not null;

create index if not exists checkout_attempts_user_created_idx
on public.checkout_attempts(user_id, created_at desc);

alter table public.checkout_attempts enable row level security;
-- No policies: service-role only. Users never read or write attempts directly.

/**
 * Closes the attempt attached to an order the moment that order reaches ANY
 * terminal state — paid, fulfilled, cancelled, refunded, chargeback — whatever
 * route caused it (webhook fulfilment, async payment failure, session expiry,
 * internal cancellation, admin action, or a path added later).
 *
 * A trigger rather than N call sites: the closure then happens in the SAME
 * transaction as the status change (atomic, never half-applied), and it cannot
 * be forgotten by a future caller. Leaving it to callers is what left the cart
 * lock held after payment, which could hand a new tab the URL of an
 * already-paid Session.
 */
create or replace function public.close_checkout_attempt_on_terminal_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('paid', 'fulfilled', 'cancelled', 'refunded', 'chargeback')
     and old.status is distinct from new.status then
    update public.checkout_attempts
    set closed_at = now(),
        closed_reason = coalesce(public.checkout_attempts.closed_reason, 'order_' || new.status::text)
    where public.checkout_attempts.order_id = new.id
      and public.checkout_attempts.closed_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_close_checkout_attempt on public.orders;
create trigger orders_close_checkout_attempt
after update of status on public.orders
for each row
execute function public.close_checkout_attempt_on_terminal_order();

/** Closes an attempt (terminal + immutable). Safe to call repeatedly. */
create or replace function public.close_checkout_attempt(
  p_claim_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update public.checkout_attempts
  set closed_at = now(), closed_reason = p_reason
  where id = p_claim_id and closed_at is null;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.close_checkout_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.close_checkout_attempt(uuid, text) to service_role;

/**
 * Compare-and-set session attachment. Binds a Stripe session to an attempt only
 * if none is bound yet; re-attaching the SAME session is a no-op success, and
 * attaching a DIFFERENT session always fails (never silently replaced — that
 * would orphan a payable session).
 */
create or replace function public.attach_checkout_session(
  p_claim_id uuid,
  p_session_id text,
  p_session_url text,
  p_session_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
begin
  select public.checkout_attempts.stripe_session_id into v_existing
  from public.checkout_attempts
  where public.checkout_attempts.id = p_claim_id
  for update;

  if not found then
    return false;
  end if;

  if v_existing is not null then
    -- Idempotent re-attach of the same session succeeds; a different one never does.
    return v_existing = p_session_id;
  end if;

  update public.checkout_attempts
  set stripe_session_id = p_session_id,
      stripe_session_url = p_session_url,
      stripe_session_expires_at = p_session_expires_at
  where id = p_claim_id;

  return true;
end;
$$;

revoke all on function public.attach_checkout_session(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.attach_checkout_session(uuid, text, text, timestamptz) to service_role;

/**
 * Claims an attempt slot, atomically.
 *
 * Returns the stored cart fingerprint so the caller can refuse an attempt id
 * replayed against a different cart. The insert-then-select pattern under a
 * unique index makes two concurrent requests (two tabs, double click, retry
 * storm) collapse onto exactly one row and therefore one order — no time
 * component, so elapsed time never changes the outcome.
 */
create or replace function public.claim_checkout_attempt(
  p_user_id uuid,
  p_attempt_id uuid,
  p_cart_fingerprint text,
  p_ttl_seconds integer default 3600
)
returns table(
  claim_id uuid,
  existing_order_id uuid,
  stored_fingerprint text,
  status text,
  attempt_expires_at timestamptz,
  stripe_session_id text,
  stripe_session_url text,
  stripe_session_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.checkout_attempts%rowtype;
  v_other public.checkout_attempts%rowtype;
begin
  -- Retire anything past its lifetime first, so an expired attempt neither
  -- resumes nor keeps holding the active-cart lock.
  -- Columns are table-qualified because several OUT parameters share their
  -- names (attempt_expires_at, stripe_session_*), which is otherwise ambiguous.
  update public.checkout_attempts
  set closed_at = now(), closed_reason = coalesce(public.checkout_attempts.closed_reason, 'expired')
  where public.checkout_attempts.user_id = p_user_id
    and public.checkout_attempts.closed_at is null
    and public.checkout_attempts.attempt_expires_at <= now();

  select * into v_row
  from public.checkout_attempts
  where public.checkout_attempts.user_id = p_user_id
    and public.checkout_attempts.attempt_id = p_attempt_id;

  if found then
    -- Terminal attempts are immutable and can never be revived.
    if v_row.closed_at is not null then
      claim_id := v_row.id;
      existing_order_id := v_row.order_id;
      stored_fingerprint := v_row.cart_fingerprint;
      status := 'closed';
      attempt_expires_at := v_row.attempt_expires_at;
      stripe_session_id := v_row.stripe_session_id;
      stripe_session_url := v_row.stripe_session_url;
      stripe_session_expires_at := v_row.stripe_session_expires_at;
      return next;
      return;
    end if;

    claim_id := v_row.id;
    existing_order_id := v_row.order_id;
    stored_fingerprint := v_row.cart_fingerprint;
    status := 'resumed';
    attempt_expires_at := v_row.attempt_expires_at;
    stripe_session_id := v_row.stripe_session_id;
    stripe_session_url := v_row.stripe_session_url;
    stripe_session_expires_at := v_row.stripe_session_expires_at;
    return next;
    return;
  end if;

  -- New attempt id. The active-cart lock decides whether it may proceed.
  begin
    insert into public.checkout_attempts (user_id, attempt_id, cart_fingerprint, attempt_expires_at)
    values (
      p_user_id,
      p_attempt_id,
      p_cart_fingerprint,
      now() + make_interval(secs => greatest(60, p_ttl_seconds))
    )
    returning * into v_row;

    claim_id := v_row.id;
    existing_order_id := null;
    stored_fingerprint := v_row.cart_fingerprint;
    status := 'new';
    attempt_expires_at := v_row.attempt_expires_at;
    stripe_session_id := null;
    stripe_session_url := null;
    stripe_session_expires_at := null;
    return next;
    return;
  exception
    when unique_violation then
      -- Another live attempt already owns this (account, cart) — either a second
      -- tab, or a concurrent request that won the race. Hand back ITS session so
      -- the caller can reuse it instead of minting a second payable one.
      select * into v_other
      from public.checkout_attempts
      where public.checkout_attempts.user_id = p_user_id
        and public.checkout_attempts.cart_fingerprint = p_cart_fingerprint
        and public.checkout_attempts.closed_at is null
      limit 1;

      claim_id := v_other.id;
      existing_order_id := v_other.order_id;
      stored_fingerprint := v_other.cart_fingerprint;
      status := 'active_elsewhere';
      attempt_expires_at := v_other.attempt_expires_at;
      stripe_session_id := v_other.stripe_session_id;
      stripe_session_url := v_other.stripe_session_url;
      stripe_session_expires_at := v_other.stripe_session_expires_at;
      return next;
      return;
  end;
end;
$$;

revoke all on function public.claim_checkout_attempt(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_checkout_attempt(uuid, uuid, text, integer) to service_role;

/** Links a created order back to its attempt, so a retry can reuse it. */
create or replace function public.attach_checkout_attempt_order(
  p_attempt_id uuid,
  p_order_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.checkout_attempts
  set order_id = p_order_id
  where id = p_attempt_id;
$$;

revoke all on function public.attach_checkout_attempt_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.attach_checkout_attempt_order(uuid, uuid) to service_role;

/** Attempts by this user inside the window — the durable rate-limit counter. */
create or replace function public.count_recent_checkout_attempts(
  p_user_id uuid,
  p_window_seconds integer default 300
)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.checkout_attempts
  where user_id = p_user_id
    and created_at > now() - make_interval(secs => greatest(1, p_window_seconds));
$$;

revoke all on function public.count_recent_checkout_attempts(uuid, integer) from public, anon, authenticated;
grant execute on function public.count_recent_checkout_attempts(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Payment review audit trail
-- ---------------------------------------------------------------------------
-- Append-only record of every refund/dispute outcome, including the ones we
-- deliberately do NOT auto-apply (partial refunds, won disputes). Unique on the
-- Stripe event id so a webhook retry cannot duplicate a review.
create table if not exists public.payment_reviews (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'stripe',
  provider_event_id text not null,
  event_type text not null,
  order_id uuid references public.orders(id) on delete set null,
  payment_intent_id text,
  reason text not null,
  status text not null default 'open',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists payment_reviews_event_idx
on public.payment_reviews(provider, provider_event_id);

create index if not exists payment_reviews_status_idx
on public.payment_reviews(status, created_at desc);

alter table public.payment_reviews enable row level security;
-- No policies: service-role only. Payment reviews are staff data, never client
-- readable — customers must not learn dispute/refund internals.

/** Idempotent review recorder. Safe to call on every webhook retry. */
create or replace function public.record_payment_review(
  p_provider_event_id text,
  p_event_type text,
  p_reason text,
  p_order_id uuid default null,
  p_payment_intent_id text default null,
  p_detail jsonb default '{}'::jsonb,
  p_provider text default 'stripe'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.payment_reviews (
    provider, provider_event_id, event_type, order_id, payment_intent_id, reason, detail
  )
  values (
    p_provider, p_provider_event_id, p_event_type, p_order_id, p_payment_intent_id, p_reason, coalesce(p_detail, '{}'::jsonb)
  )
  on conflict (provider, provider_event_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.payment_reviews
    where provider = p_provider and provider_event_id = p_provider_event_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.record_payment_review(text, text, text, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_payment_review(text, text, text, uuid, text, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Durable revocation operation keys
-- ---------------------------------------------------------------------------
-- Stripe emits SEVERAL event ids for one refund (refund.created, then one or
-- more refund.updated), and several for one dispute. Deduplicating on event id
-- alone would therefore let a single refund revoke the same order repeatedly.
-- These operations are keyed on the REFUND/DISPUTE object id instead.
create table if not exists public.payment_revocations (
  operation_key text primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  mode text not null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists payment_revocations_order_idx
on public.payment_revocations(order_id);

alter table public.payment_revocations enable row level security;
-- No policies: service-role only.

/**
 * Claims a revocation operation. Returns true only for the FIRST caller with
 * this operation key; every later call (any event id, any replay) returns false
 * so the caller skips re-revoking.
 */
create or replace function public.claim_payment_revocation(
  p_operation_key text,
  p_order_id uuid,
  p_mode text,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  insert into public.payment_revocations (operation_key, order_id, mode, reason)
  values (p_operation_key, p_order_id, p_mode, p_reason)
  on conflict (operation_key) do nothing
  returning operation_key into v_key;

  return v_key is not null;
end;
$$;

revoke all on function public.claim_payment_revocation(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_payment_revocation(text, uuid, text, text) to service_role;

/** Marks a payment-failed / expired order cancelled. Never touches a paid order. */
create or replace function public.mark_order_unpaid_closed(
  p_order_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.orders
  set status = 'cancelled',
      metadata = coalesce(metadata, '{}'::jsonb)
                 || jsonb_build_object('closed_reason', p_reason, 'closed_at', now())
  where id = p_order_id
    and status = 'pending';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.mark_order_unpaid_closed(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_order_unpaid_closed(uuid, text) to service_role;
