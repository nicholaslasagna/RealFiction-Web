alter type public.minecraft_link_status add value if not exists 'expired';

alter table public.minecraft_account_links
  add column if not exists verification_code_hash text;

alter table public.votes
  add column if not exists idempotency_key text;

create table if not exists public.profile_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.profile_settings (user_id, display_name, avatar_url)
select id, display_name, avatar_url
from public.profiles
on conflict (user_id) do update set
  display_name = coalesce(public.profile_settings.display_name, excluded.display_name),
  avatar_url = coalesce(public.profile_settings.avatar_url, excluded.avatar_url),
  updated_at = now();

create trigger profile_settings_set_updated_at
before update on public.profile_settings
for each row execute function public.set_updated_at();

alter table public.profile_settings enable row level security;

create unique index if not exists minecraft_links_verified_username_unique
on public.minecraft_account_links (lower(minecraft_username), platform)
where status = 'verified';

create unique index if not exists minecraft_links_verified_uuid_unique
on public.minecraft_account_links (minecraft_uuid, platform)
where status = 'verified' and minecraft_uuid is not null;

create index if not exists minecraft_links_code_hash_idx
on public.minecraft_account_links (verification_code_hash)
where status = 'pending';

create unique index if not exists votes_idempotency_key_unique
on public.votes (idempotency_key)
where idempotency_key is not null;

create unique index if not exists entitlements_order_item_key_unique
on public.entitlements (order_item_id, entitlement_key)
where order_item_id is not null;

insert into public.products (slug, category, name, description, price_cents, currency, fulfillment_type, duration_days, metadata, active, featured, sort_order)
values
  (
    'realvip-monthly',
    'supporter',
    'RealVIP',
    'Monthly supporter rank with profile style, chat flair, and lobby cosmetics.',
    699,
    'USD',
    'subscription',
    30,
    '{"safe_reward":true,"luckperms_group":"realvip","cosmetic_only":true}'::jsonb,
    true,
    true,
    10
  ),
  (
    'real-supporter',
    'supporter',
    'RealSupporter',
    'Permanent account supporter status for community members who want to back the network.',
    2499,
    'USD',
    'permanent',
    null,
    '{"safe_reward":true,"luckperms_group":"realsupporter","cosmetic_only":true}'::jsonb,
    true,
    true,
    20
  ),
  (
    'realpets-pack',
    'pets',
    'RealPets Pack',
    'Unlock a rotating pet collection for hubs, lobbies, and social spaces.',
    999,
    'USD',
    'permanent',
    null,
    '{"safe_reward":true,"cosmetic_type":"pets","cosmetic_only":true}'::jsonb,
    true,
    false,
    30
  ),
  (
    'particle-vault',
    'particles',
    'Particle Vault',
    'Cinematic trails, celebration effects, and lobby visual effects.',
    799,
    'USD',
    'permanent',
    null,
    '{"safe_reward":true,"cosmetic_type":"particles","cosmetic_only":true}'::jsonb,
    true,
    false,
    40
  ),
  (
    'username-colors',
    'identity',
    'Username Colors',
    'Curated chat colors and nameplate identity styles powered by LuckPerms.',
    499,
    'USD',
    'permanent',
    null,
    '{"safe_reward":true,"cosmetic_type":"chat_color","cosmetic_only":true}'::jsonb,
    true,
    false,
    50
  ),
  (
    'lobby-flight',
    'lobby',
    'Lobby Flight',
    'Smooth lobby flight for hubs, spawn showcases, and event spaces.',
    599,
    'USD',
    'permanent',
    null,
    '{"safe_reward":true,"lobby_only":true,"cosmetic_only":true}'::jsonb,
    true,
    false,
    60
  ),
  (
    'cosmetic-atelier',
    'cosmetics',
    'Cosmetic Atelier',
    'A curated bundle of profile effects, lobby entrances, particles, and badges.',
    1299,
    'USD',
    'permanent',
    null,
    '{"safe_reward":true,"cosmetic_type":"bundle","cosmetic_only":true}'::jsonb,
    true,
    true,
    70
  ),
  (
    'gift-card-25',
    'gift_cards',
    '$25 Gift Card',
    'Send store credit for cosmetics, supporter ranks, and visual profile perks.',
    2500,
    'USD',
    'consumable',
    null,
    '{"safe_reward":true,"gift_card_value_cents":2500,"cosmetic_only":true}'::jsonb,
    true,
    false,
    80
  )
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
  featured = excluded.featured,
  sort_order = excluded.sort_order,
  updated_at = now();

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
      v_expires_at := now() + make_interval(days => v_item.duration_days);
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
        coalesce(v_order.gifted_to_minecraft_username, v_order.minecraft_username),
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
          'gifted', v_order.gifted_to_minecraft_username is not null
        )
      )
      on conflict (order_item_id, entitlement_key) where order_item_id is not null do nothing;

      get diagnostics v_rows = row_count;
      v_entitlements := v_entitlements + v_rows;
    end if;

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
      coalesce(v_order.gifted_to_minecraft_username, v_order.minecraft_username),
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
        'safe_reward', true
      ),
      'order_item:' || v_item.order_item_id::text,
      'pending',
      now()
    )
    on conflict (idempotency_key) do nothing;

    get diagnostics v_rows = row_count;
    v_rewards := v_rewards + v_rows;
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

revoke all on function public.fulfill_paid_order(uuid) from public;
revoke all on function public.fulfill_paid_order(uuid) from anon;
revoke all on function public.fulfill_paid_order(uuid) from authenticated;
grant execute on function public.fulfill_paid_order(uuid) to service_role;

drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "minecraft_links_owner_access" on public.minecraft_account_links;
drop policy if exists "orders_owner_create_draft" on public.orders;
drop policy if exists "orders_admin_write" on public.orders;
drop policy if exists "entitlements_admin_write" on public.entitlements;
drop policy if exists "reward_queue_admin_write" on public.reward_queue;
drop policy if exists "gift_cards_admin_only" on public.gift_cards;
drop policy if exists "gift_redemptions_owner_read" on public.gift_card_redemptions;
drop policy if exists "coupons_admin_only" on public.coupons;
drop policy if exists "votes_admin_write" on public.votes;
drop policy if exists "vote_streaks_admin_write" on public.vote_streaks;
drop policy if exists "webhook_events_admin_only" on public.webhook_events;
drop policy if exists "support_tickets_public_insert" on public.support_tickets;
drop policy if exists "support_tickets_admin_write" on public.support_tickets;
drop policy if exists "profile_customizations_owner_access" on public.profile_customizations;

create policy "profiles_admin_write"
on public.profiles for all
using (public.is_admin())
with check (public.is_admin());

create policy "profile_settings_owner_access"
on public.profile_settings for all
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

create policy "minecraft_links_owner_read"
on public.minecraft_account_links for select
using (user_id = auth.uid() or public.is_admin());

create policy "minecraft_links_admin_write"
on public.minecraft_account_links for all
using (public.is_admin())
with check (public.is_admin());

create policy "orders_admin_write_strict"
on public.orders for all
using (public.is_admin())
with check (public.is_admin());

create policy "order_items_admin_write"
on public.order_items for all
using (public.is_admin())
with check (public.is_admin());

create policy "entitlements_admin_write_strict"
on public.entitlements for all
using (public.is_admin())
with check (public.is_admin());

create policy "reward_queue_admin_write_strict"
on public.reward_queue for all
using (public.is_admin())
with check (public.is_admin());

create policy "gift_cards_admin_write_strict"
on public.gift_cards for all
using (public.is_admin())
with check (public.is_admin());

create policy "gift_redemptions_owner_read_strict"
on public.gift_card_redemptions for select
using (user_id = auth.uid() or public.is_admin());

create policy "gift_redemptions_admin_write"
on public.gift_card_redemptions for all
using (public.is_admin())
with check (public.is_admin());

create policy "coupons_admin_write_strict"
on public.coupons for all
using (public.is_admin())
with check (public.is_admin());

create policy "votes_admin_write_strict"
on public.votes for all
using (public.is_admin())
with check (public.is_admin());

create policy "vote_streaks_admin_write_strict"
on public.vote_streaks for all
using (public.is_admin())
with check (public.is_admin());

create policy "vote_rewards_admin_write"
on public.vote_rewards for all
using (public.is_admin())
with check (public.is_admin());

create policy "webhook_events_admin_write_strict"
on public.webhook_events for all
using (public.is_admin())
with check (public.is_admin());

create policy "support_tickets_admin_write_strict"
on public.support_tickets for all
using (public.is_admin())
with check (public.is_admin());

create policy "profile_customizations_owner_access_strict"
on public.profile_customizations for all
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());
