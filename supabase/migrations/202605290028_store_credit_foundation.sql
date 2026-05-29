-- Phase 18: Store credit ledger foundation.
--
-- Adds a USD store-credit ledger that the website Account page reads as the
-- player's "Your Balance" value. This is NOT the in-game economy balance
-- (those live in public.economy_balances and represent SMP/Factions in-game
-- money); store credit is REAL-MONEY website credit, the kind you get from
-- redeeming a gift card, that can be spent at the /store checkout.
--
-- Why a separate ledger:
--   - The in-game economy ledger is gameplay money (SMP coins, Factions
--     dollars, etc.) and should never be conflated with real-world purchasing
--     power. The Account page was previously surfacing the in-game balance
--     in dollar-shaped formatting which read as "you have $7M to spend in
--     the store" — that was misleading.
--   - Gift cards already exist as SKUs in the store; this migration adds
--     the receive-and-spend side so a redeemed card actually adds credit.
--
-- This migration does NOT:
--   - touch public.economy_ledger / public.economy_balances
--   - alter any Vault / SMP-side balance
--   - change reward queues, vote rewards, HMAC plugin auth, or anything in
--     the existing economy RPC surface
--   - grant any new write capability to anon / authenticated

set search_path = public;

-- ---------------------------------------------------------------------------
-- Append-only ledger of credits and debits.
-- delta_cents > 0 = credit (gift card redemption, manual grant)
-- delta_cents < 0 = debit (store purchase paid with credit)
-- ---------------------------------------------------------------------------
create table if not exists public.store_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  delta_cents bigint not null,
  source text not null check (
    source in ('gift_card_redemption', 'store_purchase_spend', 'refund', 'manual_grant', 'manual_revoke')
  ),
  source_ref text,
  idempotency_key text,
  note text,
  created_at timestamptz not null default now()
);

create unique index if not exists store_credit_ledger_idem_key
  on public.store_credit_ledger(idempotency_key)
  where idempotency_key is not null;

create index if not exists store_credit_ledger_user_created_idx
  on public.store_credit_ledger(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Materialized current-balance view. Each user gets one row regardless of
-- how many ledger entries they have.
-- ---------------------------------------------------------------------------
create or replace view public.store_credit_balances as
  select
    user_id,
    coalesce(sum(delta_cents), 0)::bigint as balance_cents,
    max(created_at) as updated_at
  from public.store_credit_ledger
  group by user_id;

-- ---------------------------------------------------------------------------
-- Read RPC. Returns balance_cents + updated_at for a given user, with 0/null
-- for users who've never redeemed/spent. Used by the website /api/account
-- route.
-- ---------------------------------------------------------------------------
create or replace function public.get_store_credit_balance(
  p_user_id uuid
) returns table (
  balance_cents bigint,
  updated_at timestamptz
) as $$
  select
    coalesce(sum(delta_cents), 0)::bigint as balance_cents,
    max(created_at) as updated_at
  from public.store_credit_ledger
  where user_id = p_user_id;
$$ language sql stable security definer;

comment on function public.get_store_credit_balance(uuid) is
  'Read USD store-credit balance (cents) for a user. Sums their store_credit_ledger entries. Returns (0, null) for users with no history.';

-- ---------------------------------------------------------------------------
-- RLS — owner can read their own ledger entries. Service role handles all
-- writes (gift card redemption RPC, future store-credit checkout path).
-- ---------------------------------------------------------------------------
alter table public.store_credit_ledger enable row level security;

create policy "store_credit_ledger_owner_read"
  on public.store_credit_ledger for select
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants. Mirror the economy hardening posture: NO direct table access for
-- anon/authenticated; service_role only. Owner-read on the view via RLS on
-- the underlying table is enough for the Account page lookup, which goes
-- through the service-role API route anyway.
-- ---------------------------------------------------------------------------
revoke all on table public.store_credit_ledger from public, anon, authenticated;
grant select, insert, update, delete on table public.store_credit_ledger to service_role;

revoke all on function public.get_store_credit_balance(uuid) from public, anon, authenticated;
grant execute on function public.get_store_credit_balance(uuid) to service_role;
