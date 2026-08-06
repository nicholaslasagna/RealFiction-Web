-- Gift cards: secure claim credentials, recipient binding, and credit-lot
-- provenance for the stored value they create.
--
-- WHAT WAS WRONG WITH THE EXISTING SCHEMA
-- =======================================
-- 202605300030 shipped a working gift-card lifecycle with three defects that
-- make it unsafe to enable, all of them in the credential design:
--
-- 1. THE CODE SPACE IS 48 BITS. `RF-XXXX-XXXX-XXXX` is three groups of
--    `gen_random_bytes(2)` — 16 bits each, 48 bits total. The requirement is
--    128. 48 bits is inside offline brute-force range for a motivated attacker.
--
-- 2. THE VERIFIER IS AN UNKEYED SHA-256 OVER THAT SPACE. `code_hash` is
--    `sha256(normalized_code)` with no salt and no server-side key. Combined
--    with (1), reading the `code_hash` column is equivalent to reading every
--    code: 2^48 unkeyed SHA-256 evaluations is hours of commodity GPU time.
--    A read-only database leak becomes a total loss of unclaimed value.
--
-- 3. THE PLAINTEXT CODE IS STORED FOREVER, and `grant select ... to
--    authenticated` plus an RLS policy on `purchaser_user_id` exposes it to the
--    purchaser's session. It exists so the account page can reveal the code —
--    a real product need, met in the least safe available way.
--
-- Also absent: recipient binding, credential rotation, single-use semantics
-- beyond a status column, dispute freezing, and any provenance linking spent
-- store credit back to the card that funded it.
--
-- WHAT THIS DOES
-- ==============
-- Replaces the credential with a 256-bit secret that is never stored. What is
-- stored is a KEYED verifier (HMAC under a server-side pepper) for lookup, and
-- separately the delivery secret as authenticated ciphertext so the scheduled
-- email worker can render a claim link long after checkout returned.
--
-- The pepper and the encryption key are supplied by the application, never by a
-- client, and are DIFFERENT keys from the plugin HMAC, Stripe, Supabase, and
-- Resend secrets. Neither is configured here. Neither is defaulted. Every
-- function below fails closed when they are absent.
--
-- Nothing in this migration enables gift cards. `products.active` stays false
-- for every denomination and the application allowlist still refuses them.

-- ===========================================================================
-- 1. Claim credentials
-- ===========================================================================

alter table public.gift_cards
  -- Stable identity, separate from any secret. Safe to log, safe to show staff.
  add column if not exists public_ref text,
  -- Recipient binding. Null means "purchaser keeps it to gift later".
  add column if not exists recipient_email text,
  add column if not exists sender_display_name text,
  add column if not exists gift_message text,
  add column if not exists claimed_by uuid references public.profiles(id) on delete set null,
  add column if not exists claimed_at timestamptz,
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  -- Dispute freeze. Frozen value cannot be reserved or spent.
  add column if not exists frozen_at timestamptz,
  add column if not exists frozen_reason text;

comment on column public.gift_cards.code is
  'DEPRECATED, write-disabled by 202608060001. Legacy plaintext code from the pre-claim-credential design. New issuance never populates it. Retained only so already-issued value is not destroyed; see gift_card_legacy_code_migration_state().';

-- A stable, non-secret reference for support and audit: RFG-8HEXCHARS.
update public.gift_cards
set public_ref = 'RFG-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 8))
where public_ref is null;

create unique index if not exists gift_cards_public_ref_idx on public.gift_cards(public_ref);
create index if not exists gift_cards_recipient_idx on public.gift_cards(recipient_email) where recipient_email is not null;

/**
 * One issued claim credential.
 *
 * Rotation is why this is a table rather than columns: a resend or a recipient
 * correction must mint a new secret and invalidate the old one IMMEDIATELY,
 * and every one of those events has to stay in the audit trail. A column would
 * overwrite history.
 *
 * `verifier` is HMAC-SHA256(secret, pepper) — keyed, so a database leak alone
 * does not permit an offline search even if the secret space were small (it is
 * not: 256 bits). `delivery_ciphertext` is the secret sealed under a separate
 * key so the scheduled email worker can render the claim link; it is decrypted
 * only in trusted server code and never returned to a browser.
 */
create table if not exists public.gift_card_claim_credentials (
  id uuid primary key default extensions.gen_random_uuid(),
  gift_card_id uuid not null references public.gift_cards(id) on delete cascade,

  -- Keyed verifier. NOT reversible to the secret, and not searchable offline.
  verifier text not null,
  -- Which pepper version produced `verifier`, so the pepper can be rotated.
  verifier_key_version integer not null default 1,

  -- The secret, sealed. Never plaintext at rest.
  delivery_ciphertext text,
  delivery_key_version integer not null default 1,

  -- Last 4 characters of the secret's display form. Enough for a support agent
  -- to confirm they are looking at the right card; useless for claiming.
  masked_suffix text,

  state text not null default 'active'
    check (state in ('active', 'consumed', 'rotated', 'invalidated')),
  issued_at timestamptz not null default now(),
  consumed_at timestamptz,
  invalidated_at timestamptz,
  invalidated_reason text,
  -- Why this credential exists: initial issuance, a resend, or a transfer.
  issue_reason text not null default 'issued'
);

-- At most ONE active credential per card. This is the single-use spine: a
-- rotation must invalidate the previous row before inserting, and a race
-- between two rotations loses rather than minting two live secrets.
create unique index if not exists gift_card_credentials_one_active_idx
on public.gift_card_claim_credentials(gift_card_id)
where state = 'active';

-- Claim lookup is by verifier. Unique so a (vanishingly unlikely) collision is
-- a constraint violation rather than an ambiguous claim.
create unique index if not exists gift_card_credentials_verifier_idx
on public.gift_card_claim_credentials(verifier);

create index if not exists gift_card_credentials_card_idx
on public.gift_card_claim_credentials(gift_card_id, issued_at desc);

alter table public.gift_card_claim_credentials enable row level security;
-- No policies. Service-role only: a credential row is never client-readable,
-- not even by the purchaser, because it carries the verifier and the ciphertext.
revoke all on table public.gift_card_claim_credentials from public, anon, authenticated;
grant all on table public.gift_card_claim_credentials to service_role;

-- ===========================================================================
-- 2. Credit lots — provenance for stored value
-- ===========================================================================
-- `store_credit_ledger` records that credit exists. It cannot say WHERE a
-- particular dollar came from, and for gift cards that matters: gift-origin
-- value is a liability with legal characteristics (no expiry, no fees, cash
-- redemption where required by law) that promotional credit does not have.
-- Refunding a gift card must reverse gift-origin value specifically, and a
-- dispute must freeze gift-origin value specifically.

create table if not exists public.store_credit_lots (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- Where this value came from. `gift_card` is the only source with the legal
  -- characteristics above; the others are listed so provenance is explicit
  -- rather than "everything that is not a gift card".
  source text not null check (source in ('gift_card', 'refund', 'manual_grant', 'promotional')),
  gift_card_id uuid references public.gift_cards(id) on delete restrict,

  original_cents bigint not null check (original_cents > 0),
  -- Never negative, never above the original. Both enforced here, not in code.
  remaining_cents bigint not null check (remaining_cents >= 0),

  currency text not null default 'USD',
  -- Frozen lots cannot be reserved or spent. Dispute handling sets this.
  frozen_cents bigint not null default 0 check (frozen_cents >= 0),

  created_at timestamptz not null default now(),
  -- Monotonic ordering key. `created_at` defaults to now(), which in Postgres is
  -- the TRANSACTION timestamp — two lots created in one transaction are
  -- indistinguishable by it, and the fallback tiebreaker (a random uuid) made
  -- spend order non-deterministic in exactly that case. A sequence is the only
  -- thing here that is genuinely monotonic.
  lot_seq bigserial not null,
  constraint store_credit_lots_remaining_bounded check (remaining_cents <= original_cents),
  constraint store_credit_lots_frozen_bounded check (frozen_cents <= remaining_cents)
);

create index if not exists store_credit_lots_user_idx
on public.store_credit_lots(user_id, created_at)
where remaining_cents > 0;

create unique index if not exists store_credit_lots_gift_card_idx
on public.store_credit_lots(gift_card_id)
where gift_card_id is not null;

alter table public.store_credit_lots enable row level security;
revoke all on table public.store_credit_lots from public, anon, authenticated;
grant all on table public.store_credit_lots to service_role;

/**
 * Which lots funded which order, and by how much.
 *
 * This is what makes a refund restore value to the lot it came from instead of
 * creating a fresh, provenance-free credit. Without it, refunding a purchase
 * made with gift-origin credit would quietly convert a legally-characterised
 * liability into ordinary promotional credit.
 */
create table if not exists public.store_credit_lot_allocations (
  id uuid primary key default extensions.gen_random_uuid(),
  lot_id uuid not null references public.store_credit_lots(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,

  amount_cents bigint not null check (amount_cents > 0),
  state text not null default 'reserved'
    check (state in ('reserved', 'consumed', 'released', 'restored')),

  reserved_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,
  restored_cents bigint not null default 0 check (restored_cents >= 0),

  constraint lot_allocations_restore_bounded check (restored_cents <= amount_cents)
);

-- One live allocation per (lot, order): a retried checkout re-reserves rather
-- than stacking a second hold on the same lot.
create unique index if not exists lot_allocations_one_live_idx
on public.store_credit_lot_allocations(lot_id, order_id)
where state in ('reserved', 'consumed');

create index if not exists lot_allocations_order_idx
on public.store_credit_lot_allocations(order_id, state);

alter table public.store_credit_lot_allocations enable row level security;
revoke all on table public.store_credit_lot_allocations from public, anon, authenticated;
grant all on table public.store_credit_lot_allocations to service_role;

-- ===========================================================================
-- 3. Spendable balance, per provenance
-- ===========================================================================

/**
 * What this account can actually spend right now, split by provenance.
 *
 * Frozen value is excluded from `spendable_cents` deliberately: a disputed gift
 * card's remaining value must stop being spendable the moment the dispute
 * opens, without deleting the record of it.
 */
create or replace function public.store_credit_lot_balance(p_user_id uuid)
returns table(
  gift_origin_cents bigint,
  other_origin_cents bigint,
  frozen_cents bigint,
  spendable_cents bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(remaining_cents) filter (where source = 'gift_card'), 0)::bigint,
    coalesce(sum(remaining_cents) filter (where source <> 'gift_card'), 0)::bigint,
    coalesce(sum(l.frozen_cents), 0)::bigint,
    coalesce(sum(greatest(0, l.remaining_cents - l.frozen_cents)), 0)::bigint
  from public.store_credit_lots l
  where l.user_id = p_user_id
$$;

revoke all on function public.store_credit_lot_balance(uuid) from public, anon, authenticated;
grant execute on function public.store_credit_lot_balance(uuid) to service_role;

/**
 * Reserves credit against SPECIFIC lots, oldest first.
 *
 * Oldest-first, by issue sequence rather than timestamp. Gift-origin value has
 * no expiry, so this is not about avoiding forfeiture — it keeps the remaining
 * balance's provenance simple and matches how a reasonable person expects a
 * balance to work. The sequence makes it deterministic even for two lots
 * claimed in the same transaction.
 *
 * Returns the amount actually reserved. A caller that gets back less than it
 * asked for must NOT proceed — there was not enough spendable credit, and the
 * partial reservation is released by the caller's failure path.
 */
create or replace function public.reserve_credit_lots(
  p_user_id uuid,
  p_order_id uuid,
  p_amount_cents bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining bigint := greatest(0, coalesce(p_amount_cents, 0));
  v_taken bigint := 0;
  v_lot record;
  v_take bigint;
begin
  if v_remaining = 0 then
    return 0;
  end if;

  -- Serialise per account so two concurrent checkouts cannot both reserve the
  -- same last dollar.
  perform pg_advisory_xact_lock(hashtext('creditlots:' || p_user_id::text));

  -- Idempotent replay: this order already holds allocations.
  select coalesce(sum(amount_cents), 0) into v_taken
  from public.store_credit_lot_allocations
  where order_id = p_order_id and state in ('reserved', 'consumed');

  if v_taken > 0 then
    return v_taken;
  end if;

  for v_lot in
    select id, greatest(0, remaining_cents - frozen_cents) as available
    from public.store_credit_lots
    where user_id = p_user_id and remaining_cents > frozen_cents
    order by lot_seq
    for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_lot.available, v_remaining);
    if v_take <= 0 then
      continue;
    end if;

    insert into public.store_credit_lot_allocations (lot_id, order_id, amount_cents, state)
    values (v_lot.id, p_order_id, v_take, 'reserved');

    -- Held value leaves `remaining` immediately, so a second concurrent
    -- checkout cannot see it as available.
    update public.store_credit_lots
    set remaining_cents = remaining_cents - v_take
    where id = v_lot.id;

    v_remaining := v_remaining - v_take;
    v_taken := v_taken + v_take;
  end loop;

  return v_taken;
end;
$$;

revoke all on function public.reserve_credit_lots(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.reserve_credit_lots(uuid, uuid, bigint) to service_role;

/** Returns reserved lot value to its ORIGINAL lots. Idempotent. */
create or replace function public.release_credit_lots(p_order_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alloc record;
  v_released bigint := 0;
begin
  for v_alloc in
    select id, lot_id, amount_cents
    from public.store_credit_lot_allocations
    where order_id = p_order_id and state = 'reserved'
    for update
  loop
    update public.store_credit_lots
    set remaining_cents = remaining_cents + v_alloc.amount_cents
    where id = v_alloc.lot_id;

    update public.store_credit_lot_allocations
    set state = 'released', released_at = now()
    where id = v_alloc.id;

    v_released := v_released + v_alloc.amount_cents;
  end loop;

  return v_released;
end;
$$;

revoke all on function public.release_credit_lots(uuid) from public, anon, authenticated;
grant execute on function public.release_credit_lots(uuid) to service_role;

/** Marks reserved lot value spent. Called only inside successful fulfilment. */
create or replace function public.consume_credit_lots(p_order_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_consumed bigint;
begin
  update public.store_credit_lot_allocations
  set state = 'consumed', consumed_at = now()
  where order_id = p_order_id and state = 'reserved';

  select coalesce(sum(amount_cents), 0) into v_consumed
  from public.store_credit_lot_allocations
  where order_id = p_order_id and state = 'consumed';

  return v_consumed;
end;
$$;

revoke all on function public.consume_credit_lots(uuid) from public, anon, authenticated;
grant execute on function public.consume_credit_lots(uuid) to service_role;

/**
 * Restores refunded value to the lots it was actually spent from.
 *
 * Bounded twice: never more than was consumed for this order, and never more
 * than the individual allocation. A refund cannot invent gift-origin value, and
 * repeated refund events cannot restore twice.
 */
create or replace function public.restore_credit_lots(p_order_id uuid, p_amount_cents bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alloc record;
  v_remaining bigint := greatest(0, coalesce(p_amount_cents, 0));
  v_restored bigint := 0;
  v_take bigint;
begin
  for v_alloc in
    select id, lot_id, amount_cents, restored_cents
    from public.store_credit_lot_allocations
    where order_id = p_order_id and state = 'consumed'
    order by consumed_at
    for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_alloc.amount_cents - v_alloc.restored_cents, v_remaining);
    if v_take <= 0 then
      continue;
    end if;

    update public.store_credit_lots
    set remaining_cents = remaining_cents + v_take
    where id = v_alloc.lot_id;

    update public.store_credit_lot_allocations
    set restored_cents = restored_cents + v_take
    where id = v_alloc.id;

    v_remaining := v_remaining - v_take;
    v_restored := v_restored + v_take;
  end loop;

  return v_restored;
end;
$$;

revoke all on function public.restore_credit_lots(uuid, bigint) from public, anon, authenticated;
grant execute on function public.restore_credit_lots(uuid, bigint) to service_role;

-- ===========================================================================
-- 4. Dispute freeze
-- ===========================================================================

/**
 * Freezes whatever gift-origin value remains from a disputed card.
 *
 * Freezes REMAINING value only. Already-spent value is not clawed back here:
 * that would revoke unrelated products the recipient is using, which is an
 * owner decision, not something a dispute webhook should do automatically. The
 * downstream orders are recorded for review instead.
 *
 * Idempotent: re-freezing an already-frozen lot changes nothing.
 */
create or replace function public.freeze_gift_card_credit(p_gift_card_id uuid, p_reason text)
returns table(frozen_cents bigint, downstream_orders integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot public.store_credit_lots%rowtype;
  v_orders integer := 0;
begin
  select * into v_lot from public.store_credit_lots
  where gift_card_id = p_gift_card_id for update;

  if not found then
    -- Unclaimed: there is no lot yet. Voiding the card is the caller's job.
    frozen_cents := 0; downstream_orders := 0;
    return next; return;
  end if;

  update public.store_credit_lots
  set frozen_cents = remaining_cents
  where id = v_lot.id;

  update public.gift_cards
  set frozen_at = coalesce(frozen_at, now()),
      frozen_reason = coalesce(frozen_reason, p_reason)
  where id = p_gift_card_id;

  select count(distinct order_id) into v_orders
  from public.store_credit_lot_allocations
  where lot_id = v_lot.id and state = 'consumed';

  frozen_cents := v_lot.remaining_cents; downstream_orders := v_orders;
  return next;
end;
$$;

revoke all on function public.freeze_gift_card_credit(uuid, text) from public, anon, authenticated;
grant execute on function public.freeze_gift_card_credit(uuid, text) to service_role;

/** Releases a freeze after a won dispute. Idempotent. */
create or replace function public.unfreeze_gift_card_credit(p_gift_card_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unfrozen bigint := 0;
begin
  update public.store_credit_lots
  set frozen_cents = 0
  where gift_card_id = p_gift_card_id
  returning frozen_cents into v_unfrozen;

  update public.gift_cards
  set frozen_at = null, frozen_reason = null
  where id = p_gift_card_id;

  return coalesce(v_unfrozen, 0);
end;
$$;

revoke all on function public.unfreeze_gift_card_credit(uuid) from public, anon, authenticated;
grant execute on function public.unfreeze_gift_card_credit(uuid) to service_role;

-- ===========================================================================
-- 5. Claim
-- ===========================================================================

/**
 * Claims a card into store credit. ONE transaction, exactly once.
 *
 * The caller has already computed the keyed verifier from the secret the
 * recipient presented — the raw secret never reaches the database, so it cannot
 * appear in `pg_stat_statements`, a query log, or an error message.
 *
 * Outcomes are deliberately coarse toward the client: `invalid` covers "no such
 * credential", "already consumed", and "rotated away", so a caller cannot use
 * the response to distinguish a wrong guess from a real-but-spent card.
 */
create or replace function public.claim_gift_card(
  p_verifier text,
  p_user_id uuid,
  p_user_email text
)
returns table(outcome text, amount_cents bigint, gift_card_id uuid, balance_cents bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cred public.gift_card_claim_credentials%rowtype;
  v_card public.gift_cards%rowtype;
  v_lot_id uuid;
begin
  outcome := 'invalid'; amount_cents := 0; gift_card_id := null; balance_cents := 0;

  if p_verifier is null or p_user_id is null then
    return next; return;
  end if;

  select * into v_cred
  from public.gift_card_claim_credentials
  where verifier = p_verifier
  for update;

  if not found then
    return next; return;
  end if;

  select * into v_card from public.gift_cards where id = v_cred.gift_card_id for update;
  if not found then
    return next; return;
  end if;

  gift_card_id := v_card.id;

  -- Already claimed by THIS account: idempotent success, no new value.
  if v_card.status = 'redeemed' and v_card.claimed_by = p_user_id then
    outcome := 'already_claimed_by_you';
    amount_cents := v_card.original_balance_cents;
    select coalesce(sum(delta_cents), 0) into balance_cents
    from public.store_credit_ledger where user_id = p_user_id;
    return next; return;
  end if;

  -- A consumed, rotated, or invalidated credential is indistinguishable from a
  -- wrong guess.
  if v_cred.state <> 'active' then
    return next; return;
  end if;

  if v_card.status <> 'active' then
    outcome := case
      when v_card.status = 'redeemed' then 'already_claimed'
      when v_card.status = 'void' then 'void'
      else 'invalid'
    end;
    return next; return;
  end if;

  if v_card.frozen_at is not null then
    outcome := 'frozen'; return next; return;
  end if;

  -- Recipient binding. A card addressed to someone must be claimed by an
  -- account holding that verified address.
  if v_card.recipient_email is not null
     and (p_user_email is null or lower(trim(p_user_email)) <> lower(trim(v_card.recipient_email))) then
    outcome := 'wrong_recipient'; return next; return;
  end if;

  -- Single use: the credential is spent inside this transaction, so a
  -- concurrent second claim finds it non-active and gets nothing.
  update public.gift_card_claim_credentials
  set state = 'consumed', consumed_at = now()
  where id = v_cred.id and state = 'active';

  if not found then
    outcome := 'invalid'; return next; return;
  end if;

  update public.gift_cards
  set status = 'redeemed',
      claimed_by = p_user_id,
      claimed_at = now(),
      redeemed_by = p_user_id,
      redeemed_at = now(),
      balance_cents = 0
  where id = v_card.id;

  -- The ledger entry the rest of the system already understands...
  insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
  values (
    p_user_id, v_card.original_balance_cents, 'gift_card_redemption', v_card.id::text,
    'gift_card_claim:' || v_card.id::text, 'Gift card claimed'
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  -- ...plus the provenance the rest of the system does not.
  --
  -- Checked rather than ON CONFLICT: the OUT parameter is also called
  -- `gift_card_id`, so the index predicate would be ambiguous. The card row is
  -- already locked FOR UPDATE above, so this is not a race.
  if not exists (select 1 from public.store_credit_lots l where l.gift_card_id = v_card.id) then
    insert into public.store_credit_lots (
      user_id, source, gift_card_id, original_cents, remaining_cents, currency
    )
    values (
      p_user_id, 'gift_card', v_card.id,
      v_card.original_balance_cents, v_card.original_balance_cents, coalesce(v_card.currency, 'USD')
    )
    returning id into v_lot_id;
  end if;

  outcome := 'claimed';
  amount_cents := v_card.original_balance_cents;
  select coalesce(sum(delta_cents), 0) into balance_cents
  from public.store_credit_ledger where user_id = p_user_id;
  return next;
end;
$$;

revoke all on function public.claim_gift_card(text, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_gift_card(text, uuid, text) to service_role;

-- ===========================================================================
-- 6. Legacy plaintext codes
-- ===========================================================================
-- The old `redeem_gift_card(code_hash, user)` remains callable so any card
-- already issued under the previous design can still be redeemed — destroying
-- issued value would be worse than the weak credential. But new issuance never
-- writes `gift_cards.code`, and this reports whether any legacy row exists so
-- the launch runbook can make an explicit decision rather than discovering it.

create or replace function public.gift_card_legacy_code_migration_state()
returns table(legacy_plaintext_codes integer, legacy_unredeemed integer, legacy_value_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) filter (where code is not null)::integer,
    count(*) filter (where code is not null and status = 'active')::integer,
    coalesce(sum(balance_cents) filter (where code is not null and status = 'active'), 0)::bigint
  from public.gift_cards
$$;

revoke all on function public.gift_card_legacy_code_migration_state() from public, anon, authenticated;
grant execute on function public.gift_card_legacy_code_migration_state() to service_role;

-- The purchaser must no longer be able to read a plaintext secret out of the
-- table. The account page reads through a service-role view that returns
-- presentation fields only.
drop policy if exists "gift_cards_owner_read" on public.gift_cards;
revoke all on table public.gift_cards from public, anon, authenticated;
grant all on table public.gift_cards to service_role;

-- ===========================================================================
-- 7. Availability
-- ===========================================================================
-- Unchanged and deliberate: every denomination stays inactive. This migration
-- makes the system safe to build against, not available to buy.
update public.products
set active = false, updated_at = now()
where category = 'gift_cards' and active;
