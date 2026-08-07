-- Gift-card abuse and velocity controls.
--
-- WHY THIS IS IN THE DATABASE
-- ===========================
-- Cloudflare Workers isolates are per-request and are not shared, so a Map in
-- module scope is not a rate limiter — it is a rate limiter for whichever
-- isolate happened to serve the request. Every counter here is durable and
-- shared, and every decision is made server-side from those counters.
--
-- WHAT IS STORED, AND FOR HOW LONG
-- ================================
-- One row per countable act, holding the smallest thing that can be counted:
--
--   actor         the acting account id. Already ours; nothing new is learned.
--   subject_kind  what class of thing is being counted against.
--   subject       account -> the account id, in the clear (again, already ours)
--                 email/ip/recipient -> a PEPPERED SHA-256 HASH, never the value
--   amount_cents  only for value ceilings; 0 everywhere else.
--
-- There is NO device fingerprint, no user-agent, no screen or canvas signal, no
-- cookie beyond the session the site already sets, and no payment-method data of
-- any kind. An IP address is never written down: only a hash under a server-held
-- pepper, which cannot be reversed to an address and is useless if the table
-- leaks without the pepper.
--
-- RETENTION (purge_abuse_events, called by the existing scheduled worker)
--
--   ip                  7 days   the shortest window that still catches a burst
--   account/email/
--   recipient          45 days   the longest rule window (30d) plus slack
--
-- Purpose limitation: these rows exist to decide whether to allow, review, or
-- refuse a gift-card action. They are not analytics, they are not a profile, and
-- nothing outside these functions reads them.

-- ===========================================================================
-- 1. The event log
-- ===========================================================================

create table if not exists public.abuse_events (
  id bigserial primary key,
  -- gift_card_checkout | gift_card_purchase | gift_card_claim_failure
  -- | gift_card_refund_request | cash_redemption_request
  kind text not null,
  actor uuid references public.profiles(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('account', 'email', 'ip', 'recipient')),
  subject text not null,
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  occurred_at timestamptz not null default now()
);

create index if not exists abuse_events_lookup_idx
on public.abuse_events(kind, subject_kind, subject, occurred_at desc);

create index if not exists abuse_events_actor_idx
on public.abuse_events(actor, kind, occurred_at desc)
where actor is not null;

create index if not exists abuse_events_purge_idx on public.abuse_events(occurred_at);

-- Nobody but the service role. A customer reading their own abuse counters
-- would learn exactly where the thresholds sit.
alter table public.abuse_events enable row level security;
revoke all on table public.abuse_events from public, anon, authenticated;
grant all on table public.abuse_events to service_role;
revoke all on sequence public.abuse_events_id_seq from public, anon, authenticated;
grant all on sequence public.abuse_events_id_seq to service_role;

-- ===========================================================================
-- 2. The thresholds, in ONE place
-- ===========================================================================

/**
 * STAGING DEFAULTS — NOT PRODUCTION-PROVEN VALUES.
 * ===============================================
 * Every number below was chosen by reasoning about what a plausible customer
 * does, NOT from observed traffic. None of them has been validated against real
 * purchase behaviour, because gift cards have never been enabled. They are safe
 * starting points for staging and a starting point for the owner's judgment;
 * they are not calibrated limits.
 *
 * Expect to tune them once real traffic exists. The two things to watch are
 * legitimate customers hitting `block_at` (too tight) and a `review_at` tier
 * producing more items than a person can work (too loose).
 *
 * They live together, in one function, read by both the evaluator and its
 * tests — a test that hard-coded 5 somewhere else would silently stop testing
 * the real limit, and tuning would then quietly break a proof.
 *
 * Two tiers per rule:
 *   review_at  the action proceeds, and a human is asked to look
 *   block_at   the action is refused
 *
 * A rule with a null block_at can never refuse; a rule with a null review_at
 * never merely flags.
 */
create or replace function public.gift_card_abuse_limits()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    -- Checkout STARTS. Generous: a customer retrying a card decline is normal.
    'checkout_attempts_10m', jsonb_build_object('window_seconds', 600,  'review_at', 6,  'block_at', 12),
    'checkout_attempts_24h', jsonb_build_object('window_seconds', 86400,'review_at', 15, 'block_at', 30),

    -- SUCCESSFUL purchases. A real gift-buying spree is a handful, not dozens.
    'purchases_24h',         jsonb_build_object('window_seconds', 86400, 'review_at', 5,  'block_at', 10),

    -- Total VALUE. The stored-value ceiling that matters most for laundering.
    'value_24h_cents',       jsonb_build_object('window_seconds', 86400,  'review_at', 50000,  'block_at', 100000),
    'value_30d_cents',       jsonb_build_object('window_seconds', 2592000,'review_at', 200000, 'block_at', 400000),

    -- Distinct RECIPIENTS. Cycling targets is the classic reseller pattern.
    'recipients_24h',        jsonb_build_object('window_seconds', 86400, 'review_at', 5,  'block_at', 10),

    -- The SAME account -> the SAME recipient, over and over.
    'same_recipient_24h',    jsonb_build_object('window_seconds', 86400, 'review_at', 4,  'block_at', 8),

    -- Per IP, and only where the address is trustworthy. Higher than the
    -- per-account limits on purpose: a school, an office, or a carrier NAT puts
    -- many unrelated customers behind one address, and blocking them all to
    -- catch one is a worse outcome than the abuse.
    'ip_checkouts_1h',       jsonb_build_object('window_seconds', 3600, 'review_at', 15, 'block_at', 40),

    -- Failed CLAIMS. A claim secret is 256 bits; this is not what stops a brute
    -- force, it is what stops the attempt from being cheap.
    'claim_failures_15m',    jsonb_build_object('window_seconds', 900,   'review_at', null, 'block_at', 6),
    'claim_failures_24h',    jsonb_build_object('window_seconds', 86400, 'review_at', null, 'block_at', 25),

    -- REFUND requests. Refunds are rare and manual-ish; abuse here is cheap to
    -- flag and expensive to ignore.
    'refund_requests_24h',   jsonb_build_object('window_seconds', 86400, 'review_at', 3, 'block_at', 8),

    -- Cash-redemption requests. Deliberately tight: each one opens a legal
    -- review that a person has to work.
    'cash_requests_24h',     jsonb_build_object('window_seconds', 86400, 'review_at', 2, 'block_at', 5)
  );
$$;

-- ===========================================================================
-- 3. Recording
-- ===========================================================================

/**
 * Records one act against every subject it should be counted under.
 *
 * Hashes arrive ALREADY HASHED from the application, which holds the pepper.
 * The database never sees an address or an email in these columns, so a
 * database compromise alone does not yield either.
 *
 * Never raises: a counter that cannot be written must not be able to fail a
 * customer's checkout, and the evaluator fails safe on its own.
 */
create or replace function public.record_abuse_event(
  p_kind text,
  p_actor uuid,
  p_email_hash text default null,
  p_ip_hash text default null,
  p_recipient_hash text default null,
  p_amount_cents bigint default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount bigint := greatest(0, coalesce(p_amount_cents, 0));
begin
  if p_actor is not null then
    insert into public.abuse_events (kind, actor, subject_kind, subject, amount_cents)
    values (p_kind, p_actor, 'account', p_actor::text, v_amount);
  end if;

  if coalesce(p_email_hash, '') <> '' then
    insert into public.abuse_events (kind, actor, subject_kind, subject, amount_cents)
    values (p_kind, p_actor, 'email', p_email_hash, v_amount);
  end if;

  if coalesce(p_ip_hash, '') <> '' then
    insert into public.abuse_events (kind, actor, subject_kind, subject, amount_cents)
    values (p_kind, p_actor, 'ip', p_ip_hash, v_amount);
  end if;

  if coalesce(p_recipient_hash, '') <> '' then
    insert into public.abuse_events (kind, actor, subject_kind, subject, amount_cents)
    values (p_kind, p_actor, 'recipient', p_recipient_hash, v_amount);
  end if;
exception when others then
  -- Swallowed on purpose. See the contract above.
  null;
end;
$$;

revoke all on function public.record_abuse_event(text, uuid, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.record_abuse_event(text, uuid, text, text, text, bigint) to service_role;

-- ===========================================================================
-- 4. Evaluating
-- ===========================================================================

/** One rule against one count. Returns 'allow', 'review', or 'block'. */
create or replace function public.apply_abuse_rule(p_rule text, p_observed bigint)
returns text
language sql
stable
as $$
  select case
    when (public.gift_card_abuse_limits() -> p_rule ->> 'block_at') is not null
     and p_observed >= (public.gift_card_abuse_limits() -> p_rule ->> 'block_at')::bigint then 'block'
    when (public.gift_card_abuse_limits() -> p_rule ->> 'review_at') is not null
     and p_observed >= (public.gift_card_abuse_limits() -> p_rule ->> 'review_at')::bigint then 'review'
    else 'allow'
  end;
$$;

/** Seconds in a rule's window. */
create or replace function public.abuse_rule_window(p_rule text)
returns integer
language sql
stable
as $$
  select (public.gift_card_abuse_limits() -> p_rule ->> 'window_seconds')::integer;
$$;

/**
 * The gift-card PURCHASE decision.
 *
 * Evaluated before an order, a credit reservation, or a Stripe session exists,
 * so a refusal leaves nothing behind.
 *
 * Returns the STRONGEST outcome across every rule, and the rule that produced
 * it. The rule name is for our logs and the review record — the customer is
 * never told which limit they hit, because that is a map of the thresholds.
 */
create or replace function public.evaluate_gift_card_velocity(
  p_actor uuid,
  p_email_hash text default null,
  p_ip_hash text default null,
  p_recipient_hash text default null,
  p_amount_cents bigint default 0
)
returns table(decision text, rule text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_worst text := 'allow';
  v_rule text := null;
  v_rank jsonb := jsonb_build_object('allow', 0, 'review', 1, 'block', 2);
  v_check record;
begin
  for v_check in
    -- Attempt velocity, per account.
    select 'checkout_attempts_10m' as rule, (
      select count(*) from public.abuse_events e
      where e.kind = 'gift_card_checkout' and e.subject_kind = 'account' and e.subject = p_actor::text
        and e.occurred_at > now() - make_interval(secs => public.abuse_rule_window('checkout_attempts_10m'))
    ) as observed
    union all
    select 'checkout_attempts_24h', (
      select count(*) from public.abuse_events e
      where e.kind = 'gift_card_checkout' and e.subject_kind = 'account' and e.subject = p_actor::text
        and e.occurred_at > now() - make_interval(secs => public.abuse_rule_window('checkout_attempts_24h'))
    )
    union all
    -- Completed purchases.
    select 'purchases_24h', (
      select count(*) from public.abuse_events e
      where e.kind = 'gift_card_purchase' and e.subject_kind = 'account' and e.subject = p_actor::text
        and e.occurred_at > now() - make_interval(secs => public.abuse_rule_window('purchases_24h'))
    )
    union all
    -- Value ceilings INCLUDE the purchase being considered, so the limit is a
    -- ceiling on total stored value rather than on value already bought.
    select 'value_24h_cents', greatest(0, coalesce(p_amount_cents, 0)) + (
      select coalesce(sum(e.amount_cents), 0) from public.abuse_events e
      where e.kind = 'gift_card_purchase' and e.subject_kind = 'account' and e.subject = p_actor::text
        and e.occurred_at > now() - make_interval(secs => public.abuse_rule_window('value_24h_cents'))
    )
    union all
    select 'value_30d_cents', greatest(0, coalesce(p_amount_cents, 0)) + (
      select coalesce(sum(e.amount_cents), 0) from public.abuse_events e
      where e.kind = 'gift_card_purchase' and e.subject_kind = 'account' and e.subject = p_actor::text
        and e.occurred_at > now() - make_interval(secs => public.abuse_rule_window('value_30d_cents'))
    )
    union all
    -- Distinct recipients this account has targeted, counting the new one.
    select 'recipients_24h', (
      select count(distinct e.subject) from public.abuse_events e
      where e.kind in ('gift_card_checkout', 'gift_card_purchase')
        and e.subject_kind = 'recipient' and e.actor = p_actor
        and e.subject <> coalesce(p_recipient_hash, '')
        and e.occurred_at > now() - make_interval(secs => public.abuse_rule_window('recipients_24h'))
    ) + case when coalesce(p_recipient_hash, '') = '' then 0 else 1 end
    union all
    -- The same pair, over and over.
    select 'same_recipient_24h', (
      select count(*) from public.abuse_events e
      where e.kind = 'gift_card_checkout' and e.subject_kind = 'recipient'
        and e.actor = p_actor and e.subject = coalesce(p_recipient_hash, '')
        and e.occurred_at > now() - make_interval(secs => public.abuse_rule_window('same_recipient_24h'))
    )
    union all
    -- Per IP, only when the application decided the address was trustworthy.
    select 'ip_checkouts_1h', (
      select count(*) from public.abuse_events e
      where e.kind = 'gift_card_checkout' and e.subject_kind = 'ip'
        and e.subject = coalesce(p_ip_hash, '')
        and coalesce(p_ip_hash, '') <> ''
        and e.occurred_at > now() - make_interval(secs => public.abuse_rule_window('ip_checkouts_1h'))
    )
    union all
    -- A verified email is a stronger identity than an account: a burst of new
    -- accounts on one mailbox is exactly what this catches.
    select 'checkout_attempts_24h', (
      select count(*) from public.abuse_events e
      where e.kind = 'gift_card_checkout' and e.subject_kind = 'email'
        and e.subject = coalesce(p_email_hash, '')
        and coalesce(p_email_hash, '') <> ''
        and e.occurred_at > now() - make_interval(secs => public.abuse_rule_window('checkout_attempts_24h'))
    )
  loop
    -- `union all` widens the counts to numeric; the rule takes a bigint.
    if (v_rank ->> public.apply_abuse_rule(v_check.rule, v_check.observed::bigint))::int
       > (v_rank ->> v_worst)::int then
      v_worst := public.apply_abuse_rule(v_check.rule, v_check.observed::bigint);
      v_rule := v_check.rule;
    end if;
  end loop;

  decision := v_worst; rule := v_rule;
  return next;
end;
$$;

revoke all on function public.evaluate_gift_card_velocity(uuid, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.evaluate_gift_card_velocity(uuid, text, text, text, bigint) to service_role;

/**
 * A single-rule counter, for the paths that need one number rather than the
 * whole purchase evaluation: failed claims, refund requests, cash requests.
 */
create or replace function public.evaluate_abuse_rule_for_actor(
  p_rule text,
  p_kind text,
  p_actor uuid
)
returns table(decision text, observed bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_count bigint;
begin
  select count(*) into v_count from public.abuse_events e
  where e.kind = p_kind and e.subject_kind = 'account' and e.subject = p_actor::text
    and e.occurred_at > now() - make_interval(secs => public.abuse_rule_window(p_rule));

  decision := public.apply_abuse_rule(p_rule, v_count);
  observed := v_count;
  return next;
end;
$$;

revoke all on function public.evaluate_abuse_rule_for_actor(text, text, uuid) from public, anon, authenticated;
grant execute on function public.evaluate_abuse_rule_for_actor(text, text, uuid) to service_role;

-- ===========================================================================
-- 5. Review records
-- ===========================================================================

/**
 * Files a velocity review for a human, once per (actor, rule, day).
 *
 * Deduped so a customer who trips the same rule fifteen times produces one item
 * in the queue rather than fifteen. The detail carries the rule name and the
 * account — never the hashed subjects, which would let a reviewer correlate a
 * hash across accounts and quietly rebuild the identifier we declined to store.
 */
create or replace function public.record_velocity_review(
  p_actor uuid,
  p_rule text,
  p_kind text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.payment_reviews (provider, provider_event_id, event_type, order_id, reason, detail)
  values (
    'internal',
    'velocity:' || p_actor::text || ':' || p_rule || ':' || to_char(now(), 'YYYY-MM-DD'),
    'gift_card_velocity',
    null,
    'gift_card_velocity_' || p_rule,
    jsonb_build_object('priority', 'normal', 'actor', p_actor, 'rule', p_rule, 'kind', p_kind)
  )
  on conflict (provider, provider_event_id) do nothing;
exception when others then
  null;
end;
$$;

revoke all on function public.record_velocity_review(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_velocity_review(uuid, text, text) to service_role;

-- ===========================================================================
-- 6. Retention
-- ===========================================================================

/**
 * Deletes what is no longer needed to make a decision.
 *
 * IP hashes go first and go early: they are the only subject derived from
 * something the customer did not give us, and the rule that uses them looks
 * back one hour.
 */
create or replace function public.purge_abuse_events()
returns table(ip_rows bigint, other_rows bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  with deleted as (
    delete from public.abuse_events
    where subject_kind = 'ip' and occurred_at < now() - interval '7 days'
    returning 1
  )
  select count(*) into ip_rows from deleted;

  with deleted as (
    delete from public.abuse_events
    where subject_kind <> 'ip' and occurred_at < now() - interval '45 days'
    returning 1
  )
  select count(*) into other_rows from deleted;

  return next;
end;
$$;

revoke all on function public.purge_abuse_events() from public, anon, authenticated;
grant execute on function public.purge_abuse_events() to service_role;
