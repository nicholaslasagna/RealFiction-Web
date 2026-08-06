-- Permanent ranks, rank inclusion, RealFiction+ pass, and upgrade pricing.
--
-- LEGACY COMPATIBILITY POLICY (the important part)
-- ================================================
-- Existing customers bought fixed terms (realvip-1m, real-supporter-12m, ...).
-- Those entitlements are already granted with real expiry dates.
--
-- This migration DOES NOT touch a single existing entitlement, order, or
-- expiry. It:
--   * adds new permanent SKUs alongside the legacy term SKUs,
--   * deactivates the legacy term SKUs so they cannot be SOLD again,
--   * leaves every already-purchased term running to its paid-for expiry.
--
-- Rejected alternatives and why:
--   * Auto-converting active terms to permanent — silently reinterprets what
--     someone paid for, and over-grants (a 1-month buyer did not buy forever).
--   * Deleting legacy SKUs — breaks order_items joins and the account page's
--     product lookups for historical orders.
--   * Pro-rating remaining term value into permanent — needs a refund/credit
--     policy decision that is the owner's to make, not a migration's.
--
-- Net effect: nobody loses value, nobody is silently re-scoped, and future
-- sales are permanent-only.

-- ---------------------------------------------------------------------------
-- 1. Rank inclusion
-- ---------------------------------------------------------------------------
-- RealSupporter includes RealVIP. Enforced at fulfilment so the entitlement is
-- really granted, not merely implied by UI copy.
create table if not exists public.product_inclusions (
  parent_slug text not null,
  child_slug text not null,
  created_at timestamptz not null default now(),
  primary key (parent_slug, child_slug),
  -- A product including itself would make the recursive grant non-terminating.
  constraint product_inclusions_no_self check (parent_slug <> child_slug)
);

alter table public.product_inclusions enable row level security;
-- Readable by anyone (it is public catalog structure); writable by service role.
drop policy if exists "product_inclusions_public_read" on public.product_inclusions;
create policy "product_inclusions_public_read" on public.product_inclusions
  for select using (true);

insert into public.product_inclusions (parent_slug, child_slug) values
  ('real-supporter-permanent', 'realvip-permanent'),
  ('cosmetic-atelier-permanent', 'username-colors-permanent'),
  ('cosmetic-atelier-permanent', 'particle-vault-permanent'),
  ('cosmetic-atelier-permanent', 'realpets-permanent')
on conflict (parent_slug, child_slug) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Upgrade paths
-- ---------------------------------------------------------------------------
create table if not exists public.product_upgrades (
  from_slug text not null,
  to_slug text not null,
  created_at timestamptz not null default now(),
  primary key (from_slug, to_slug),
  constraint product_upgrades_no_self check (from_slug <> to_slug)
);

alter table public.product_upgrades enable row level security;
drop policy if exists "product_upgrades_public_read" on public.product_upgrades;
create policy "product_upgrades_public_read" on public.product_upgrades
  for select using (true);

insert into public.product_upgrades (from_slug, to_slug) values
  ('realvip-permanent', 'real-supporter-permanent')
on conflict (from_slug, to_slug) do nothing;

-- Records which order's payment has already been consumed as upgrade credit, so
-- one RealVIP purchase can never fund two upgrades.
create table if not exists public.upgrade_credits_consumed (
  source_order_id uuid primary key references public.orders(id) on delete cascade,
  upgrade_order_id uuid not null references public.orders(id) on delete cascade,
  from_slug text not null,
  to_slug text not null,
  credit_cents bigint not null check (credit_cents >= 0),
  created_at timestamptz not null default now()
);

alter table public.upgrade_credits_consumed enable row level security;
-- No policies: service-role only. Purchase history is not client-readable.

-- ---------------------------------------------------------------------------
-- 3. Catalog: new permanent SKUs + the RealFiction+ pass
-- ---------------------------------------------------------------------------
insert into public.products (
  slug, category, name, description, price_cents, currency,
  fulfillment_type, duration_days, metadata, active, featured, sort_order
)
values
  ('realvip-permanent', 'supporter', 'RealVIP',
   'Permanent supporter rank. Cosmetic only, no gameplay advantages.',
   1299, 'USD', 'permanent', null,
   jsonb_build_object('safe_reward', true, 'cosmetic_only', true,
     'luckperms_group', 'realvip', 'permanent', true), true, false, 10),

  ('real-supporter-permanent', 'supporter', 'RealSupporter',
   'Permanent premium rank. Includes RealVIP. Cosmetic only, no gameplay advantages.',
   3499, 'USD', 'permanent', null,
   jsonb_build_object('safe_reward', true, 'cosmetic_only', true,
     'luckperms_group', 'realsupporter', 'permanent', true), true, false, 20),

  -- NOT purchasable. Seeded inactive on purpose: none of the advertised
  -- benefits (collectible grant, rotating vault, member frame, extra loadout
  -- slots, temporary lobby flight) exist in RealCore yet, so selling it would
  -- take money for entitlements nothing can deliver. Flip active=true only when
  -- the benefits are implemented end to end.
  ('realfiction-plus-30d', 'supporter', 'RealFiction+',
   '30 days of membership. One-time purchase, does not automatically renew.',
   599, 'USD', 'subscription', 30,
   jsonb_build_object('safe_reward', true, 'cosmetic_only', true,
     'luckperms_permission', 'realfiction.plus', 'membership', true), false, false, 30),

  ('username-colors-permanent', 'identity', 'Username Colours',
   'Permanent username colour palette. Cosmetic only.',
   499, 'USD', 'permanent', null,
   jsonb_build_object('safe_reward', true, 'cosmetic_only', true,
     'luckperms_permission', 'realfiction.username.colors', 'cosmetic_type', 'chat_color'), true, false, 40),

  ('particle-vault-permanent', 'particles', 'Particle Vault',
   'Permanent particle effect collection. Cosmetic only.',
   899, 'USD', 'permanent', null,
   jsonb_build_object('safe_reward', true, 'cosmetic_only', true,
     'luckperms_permission', 'realfiction.particles.vault', 'cosmetic_type', 'particles'), true, false, 50),

  ('realpets-permanent', 'pets', 'RealPets Pack',
   'Permanent lobby companion pets. Cosmetic only.',
   799, 'USD', 'permanent', null,
   jsonb_build_object('safe_reward', true, 'cosmetic_only', true,
     'luckperms_permission', 'realfiction.pets.pack', 'cosmetic_type', 'pets'), true, false, 60),

  ('cosmetic-atelier-permanent', 'cosmetics', 'Cosmetic Atelier',
   'Permanent cosmetic bundle. Includes colours, particles and pets. Cosmetic only.',
   1799, 'USD', 'permanent', null,
   jsonb_build_object('safe_reward', true, 'cosmetic_only', true,
     'luckperms_permission', 'realfiction.cosmetics.atelier', 'cosmetic_type', 'bundle'), true, false, 70)
on conflict (slug) do update set
  category = excluded.category,
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  fulfillment_type = excluded.fulfillment_type,
  duration_days = excluded.duration_days,
  metadata = excluded.metadata,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at = now();

-- DELIBERATELY NOT deactivating the legacy term SKUs here.
--
-- This migration is the ADDITIVE stage of expand-and-contract. It runs while
-- the OLD application is still deployed, and that application sells the term
-- SKUs. Flipping active=false here would break checkout for every customer
-- between the migration and the deploy — an outage caused purely by ordering.
--
-- Legacy SKUs therefore stay resolvable, fulfillable, refundable and revocable,
-- and any Stripe session already in flight still completes.
--
-- The NEW application stops OFFERING them via a server-authoritative
-- purchasable-product policy (lib/store/catalog.ts + the checkout guard), not
-- by UI hiding. Deactivating the rows is a separate CLEANUP migration, to be
-- applied only after the new app is deployed, old sessions have expired, and
-- production has been observed. That migration is intentionally not part of
-- this rollout.

-- ---------------------------------------------------------------------------
-- 4. Grant included products at fulfilment
-- ---------------------------------------------------------------------------
/**
 * Grants the entitlements a purchased product INCLUDES, one level of recursion
 * expanded iteratively (the catalog is intentionally shallow).
 *
 * Idempotent: the entitlement insert is keyed on (order_item_id,
 * entitlement_key), so a replayed webhook grants nothing extra.
 */
create or replace function public.grant_included_entitlements(
  p_order_id uuid,
  p_order_item_id uuid,
  p_slug text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_child text;
  v_granted integer := 0;
  v_rows integer;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return 0;
  end if;

  -- Transitive closure, cycle-safe via `cycle` detection.
  for v_child in
    with recursive tree(child) as (
      select child_slug from public.product_inclusions where parent_slug = p_slug
      union
      select i.child_slug
      from public.product_inclusions i
      join tree t on i.parent_slug = t.child
    )
    select child from tree
  loop
    insert into public.entitlements (
      user_id, minecraft_uuid, minecraft_username, product_id, order_item_id,
      entitlement_key, status, starts_at, expires_at, metadata
    )
    select
      v_order.user_id, v_order.minecraft_uuid,
      coalesce(v_order.gifted_to_minecraft_username, v_order.minecraft_username),
      p.id, p_order_item_id, 'product:' || v_child, 'active', now(),
      null,  -- included rank benefits are permanent, like their parent
      jsonb_build_object('source', 'inclusion', 'order_id', p_order_id,
        'included_by', p_slug, 'product_slug', v_child)
    from public.products p
    where p.slug = v_child
    on conflict (order_item_id, entitlement_key) where order_item_id is not null do nothing;

    get diagnostics v_rows = row_count;
    v_granted := v_granted + v_rows;
  end loop;

  return v_granted;
end;
$$;

revoke all on function public.grant_included_entitlements(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.grant_included_entitlements(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Authoritative upgrade pricing
-- ---------------------------------------------------------------------------
/**
 * What this account must pay to upgrade to `p_to_slug`, computed entirely
 * server-side.
 *
 *   upgrade price = target price - credit already paid for the source product
 *
 * Safety properties:
 *   * Credit comes from order_items of PAID/FULFILLED orders only.
 *   * An order already recorded in upgrade_credits_consumed is excluded, so one
 *     purchase can never fund two upgrades.
 *   * Refunded/chargeback orders are excluded — a refunded RealVIP grants no
 *     credit.
 *   * The result is clamped at 0: never negative, never a payout.
 *   * Returns eligible=false when the user already owns the target, so an
 *     upgrade cannot be used to buy the same rank twice.
 */
create or replace function public.compute_upgrade_price(
  p_user_id uuid,
  p_to_slug text
)
returns table(
  eligible boolean,
  reason text,
  target_price_cents bigint,
  credit_cents bigint,
  upgrade_price_cents bigint,
  source_order_id uuid,
  from_slug text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text;
  v_target bigint;
  v_credit bigint := 0;
  v_source uuid;
begin
  select p.price_cents into v_target
  from public.products p where p.slug = p_to_slug and p.active;

  if v_target is null then
    eligible := false; reason := 'target_not_purchasable';
    target_price_cents := 0; credit_cents := 0; upgrade_price_cents := 0;
    source_order_id := null; from_slug := null;
    return next; return;
  end if;

  -- Already owns the target -> not an upgrade.
  if exists (
    select 1 from public.entitlements e
    where e.user_id = p_user_id
      and e.entitlement_key = 'product:' || p_to_slug
      and e.status = 'active'
      and (e.expires_at is null or e.expires_at > now())
  ) then
    eligible := false; reason := 'already_owned';
    target_price_cents := v_target; credit_cents := 0; upgrade_price_cents := v_target;
    source_order_id := null; from_slug := null;
    return next; return;
  end if;

  select u.from_slug into v_from
  from public.product_upgrades u where u.to_slug = p_to_slug limit 1;

  if v_from is null then
    eligible := false; reason := 'no_upgrade_path';
    target_price_cents := v_target; credit_cents := 0; upgrade_price_cents := v_target;
    source_order_id := null; from_slug := null;
    return next; return;
  end if;

  -- Highest unconsumed payment for the source product on a settled order.
  select oi.total_cents, o.id
  into v_credit, v_source
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.products p on p.id = oi.product_id
  where o.user_id = p_user_id
    and p.slug = v_from
    and o.status in ('paid', 'fulfilled')
    and not exists (
      select 1 from public.upgrade_credits_consumed c where c.source_order_id = o.id
    )
  order by oi.total_cents desc, o.created_at asc
  limit 1;

  if v_source is null then
    eligible := false; reason := 'no_eligible_purchase';
    target_price_cents := v_target; credit_cents := 0; upgrade_price_cents := v_target;
    source_order_id := null; from_slug := v_from;
    return next; return;
  end if;

  eligible := true;
  reason := 'ok';
  target_price_cents := v_target;
  credit_cents := coalesce(v_credit, 0);
  -- Never negative: a source that cost more than the target upgrades for free,
  -- never for a refund.
  upgrade_price_cents := greatest(0, v_target - coalesce(v_credit, 0));
  source_order_id := v_source;
  from_slug := v_from;
  return next;
end;
$$;

revoke all on function public.compute_upgrade_price(uuid, text) from public, anon, authenticated;
grant execute on function public.compute_upgrade_price(uuid, text) to service_role;

/**
 * Consumes an upgrade credit, atomically.
 *
 * The primary key on source_order_id is the race guard: two concurrent upgrade
 * checkouts for the same source purchase cannot both succeed — the second
 * insert conflicts and returns false, so the caller must charge full price or
 * abort.
 */
create or replace function public.consume_upgrade_credit(
  p_source_order_id uuid,
  p_upgrade_order_id uuid,
  p_from_slug text,
  p_to_slug text,
  p_credit_cents bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key uuid;
begin
  insert into public.upgrade_credits_consumed (
    source_order_id, upgrade_order_id, from_slug, to_slug, credit_cents
  )
  values (p_source_order_id, p_upgrade_order_id, p_from_slug, p_to_slug, greatest(0, p_credit_cents))
  on conflict (source_order_id) do nothing
  returning source_order_id into v_key;

  return v_key is not null;
end;
$$;

revoke all on function public.consume_upgrade_credit(uuid, uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.consume_upgrade_credit(uuid, uuid, text, text, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Wire inclusion into fulfilment
-- ---------------------------------------------------------------------------
-- fulfill_paid_order is re-created with ONE addition: after granting an item's
-- own entitlement it grants whatever that product includes. Everything else —
-- stacking, reward_queue idempotency, gift-card guard, terminal status — is
-- byte-identical to 202607170001.
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
  select * into v_order from public.orders where id = p_order_id for update;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if v_order.status = 'fulfilled' then
    order_id := p_order_id; created_entitlements := 0; created_rewards := 0;
    already_fulfilled := true; return next; return;
  end if;

  if v_order.status not in ('paid', 'pending') then
    raise exception 'Order % is not fulfillable from status %', p_order_id, v_order.status;
  end if;

  update public.orders
  set status = 'paid', paid_at = coalesce(paid_at, now())
  where id = p_order_id;

  v_target_uuid := v_order.minecraft_uuid;
  v_target_username := coalesce(v_order.gifted_to_minecraft_username, v_order.minecraft_username);

  for v_item in
    select oi.id as order_item_id, oi.quantity, oi.product_snapshot,
           p.id as product_id, p.slug, p.category, p.name,
           p.fulfillment_type, p.duration_days, p.metadata
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id
  loop
    v_entitlement_key := 'product:' || v_item.slug;
    v_expires_at := null;

    if v_item.fulfillment_type = 'subscription' and v_item.duration_days is not null then
      select max(e.expires_at) into v_existing_expiry
      from public.entitlements e
      where e.entitlement_key = v_entitlement_key
        and e.status = 'active'
        and e.expires_at is not null
        and (
          (v_target_uuid is not null and e.minecraft_uuid = v_target_uuid)
          or (v_target_uuid is null and v_target_username is not null
              and lower(e.minecraft_username) = lower(v_target_username))
        );

      v_expires_at := greatest(coalesce(v_existing_expiry, now()), now())
                      + make_interval(days => v_item.duration_days);
    end if;

    if v_item.fulfillment_type <> 'consumable' then
      insert into public.entitlements (
        user_id, minecraft_uuid, minecraft_username, product_id, order_item_id,
        entitlement_key, status, starts_at, expires_at, metadata
      )
      values (
        v_order.user_id, v_order.minecraft_uuid, v_target_username,
        v_item.product_id, v_item.order_item_id, v_entitlement_key, 'active', now(), v_expires_at,
        jsonb_build_object('source', 'order', 'order_id', p_order_id,
          'product_slug', v_item.slug, 'quantity', v_item.quantity,
          'gifted', v_order.gifted_to_minecraft_username is not null,
          'stacked_from', v_existing_expiry)
      )
      on conflict (order_item_id, entitlement_key) where order_item_id is not null do nothing;

      get diagnostics v_rows = row_count;
      v_entitlements := v_entitlements + v_rows;

      -- NEW: grant whatever this product includes (RealSupporter -> RealVIP).
      v_entitlements := v_entitlements
        + public.grant_included_entitlements(p_order_id, v_item.order_item_id, v_item.slug);
    end if;

    if v_item.category <> 'gift_cards' then
      insert into public.reward_queue (
        user_id, minecraft_uuid, minecraft_username, source, source_id,
        reward_key, payload, idempotency_key, status, available_at
      )
      values (
        v_order.user_id, v_order.minecraft_uuid, v_target_username, 'store',
        v_item.order_item_id, 'store.' || v_item.slug,
        jsonb_build_object('order_id', p_order_id, 'order_item_id', v_item.order_item_id,
          'product_id', v_item.product_id, 'product_slug', v_item.slug,
          'category', v_item.category, 'fulfillment_type', v_item.fulfillment_type,
          'duration_days', v_item.duration_days, 'quantity', v_item.quantity,
          'metadata', v_item.metadata, 'expires_at', v_expires_at, 'safe_reward', true),
        'order_item:' || v_item.order_item_id::text, 'pending', now()
      )
      on conflict (idempotency_key) do nothing;

      get diagnostics v_rows = row_count;
      v_rewards := v_rewards + v_rows;
    end if;
  end loop;

  update public.orders
  set status = 'fulfilled', fulfilled_at = coalesce(fulfilled_at, now())
  where id = p_order_id;

  order_id := p_order_id; created_entitlements := v_entitlements;
  created_rewards := v_rewards; already_fulfilled := false;
  return next;
end;
$$;

revoke all on function public.fulfill_paid_order(uuid) from public, anon, authenticated;
grant execute on function public.fulfill_paid_order(uuid) to service_role;
