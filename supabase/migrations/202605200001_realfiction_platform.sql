create extension if not exists pgcrypto with schema extensions;

do $$
begin
  create type public.app_role as enum ('player', 'supporter', 'staff', 'admin', 'owner');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.minecraft_link_status as enum ('pending', 'verified', 'revoked');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.product_category as enum ('supporter', 'cosmetics', 'pets', 'particles', 'identity', 'lobby', 'gift_cards');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.product_fulfillment_type as enum ('permanent', 'subscription', 'consumable');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.order_provider as enum ('stripe', 'paypal', 'gift_card', 'manual');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.order_status as enum ('draft', 'pending', 'paid', 'fulfilled', 'refunded', 'chargeback', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.entitlement_status as enum ('active', 'expired', 'revoked', 'refunded');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.reward_status as enum ('pending', 'processing', 'delivered', 'failed', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.reward_source as enum ('store', 'vote', 'gift_card', 'admin', 'subscription', 'event');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.support_ticket_status as enum ('open', 'triage', 'waiting_on_player', 'resolved', 'closed');
exception when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.prevent_profile_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Profile role cannot be changed by this user';
  end if;

  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role public.app_role not null default 'player',
  primary_minecraft_uuid text,
  primary_minecraft_username text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.minecraft_account_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  minecraft_uuid text,
  minecraft_username text not null,
  platform text not null default 'java' check (platform in ('java', 'bedrock')),
  verification_code text not null,
  status public.minecraft_link_status not null default 'pending',
  verified_at timestamptz,
  expires_at timestamptz not null default now() + interval '20 minutes',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, minecraft_username, platform)
);

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  category public.product_category not null,
  name text not null,
  description text not null,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'USD',
  fulfillment_type public.product_fulfillment_type not null,
  duration_days integer check (duration_days is null or duration_days > 0),
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  featured boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_no_pay_to_win check (
    category in ('supporter', 'cosmetics', 'pets', 'particles', 'identity', 'lobby', 'gift_cards')
  )
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  minecraft_uuid text,
  minecraft_username text,
  provider public.order_provider not null,
  provider_session_id text,
  provider_payment_id text,
  status public.order_status not null default 'draft',
  subtotal_cents integer not null default 0,
  discount_cents integer not null default 0,
  total_cents integer not null default 0,
  currency text not null default 'USD',
  coupon_code text,
  gifted_to_minecraft_username text,
  metadata jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_session_id)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_snapshot jsonb not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  minecraft_uuid text,
  minecraft_username text,
  product_id uuid references public.products(id),
  order_item_id uuid references public.order_items(id) on delete set null,
  entitlement_key text not null,
  status public.entitlement_status not null default 'active',
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reward_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  minecraft_uuid text,
  minecraft_username text,
  source public.reward_source not null,
  source_id uuid,
  reward_key text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  status public.reward_status not null default 'pending',
  attempts integer not null default 0,
  server_group text not null default 'global',
  available_at timestamptz not null default now(),
  processing_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  original_balance_cents integer not null check (original_balance_cents > 0),
  balance_cents integer not null check (balance_cents >= 0),
  currency text not null default 'USD',
  purchaser_user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'depleted', 'expired', 'revoked')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gift_card_redemptions (
  id uuid primary key default gen_random_uuid(),
  gift_card_id uuid not null references public.gift_cards(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  percent_off integer check (percent_off is null or (percent_off > 0 and percent_off <= 100)),
  amount_off_cents integer check (amount_off_cents is null or amount_off_cents > 0),
  max_redemptions integer,
  redemption_count integer not null default 0,
  active boolean not null default true,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_discount_present check (percent_off is not null or amount_off_cents is not null)
);

create table if not exists public.vote_sites (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  url text not null,
  cooldown_hours integer not null default 24,
  reward_key text not null default 'vote.standard',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.vote_sites(id),
  user_id uuid references public.profiles(id) on delete set null,
  minecraft_uuid text,
  minecraft_username text not null,
  provider_event_id text,
  ip_hash text,
  voted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (site_id, provider_event_id)
);

create table if not exists public.vote_streaks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  minecraft_uuid text,
  minecraft_username text not null,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  monthly_votes integer not null default 0,
  total_votes integer not null default 0,
  last_vote_at timestamptz,
  month_key text not null default to_char(now(), 'YYYY-MM'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (minecraft_username, month_key)
);

create table if not exists public.vote_rewards (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid references public.votes(id) on delete cascade,
  reward_queue_id uuid references public.reward_queue(id) on delete set null,
  reward_key text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider public.order_provider not null,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_type text not null default 'system',
  action text not null,
  target_table text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  email text not null,
  minecraft_username text,
  topic text not null,
  message text not null,
  status public.support_ticket_status not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.updates (
  id uuid primary key default gen_random_uuid(),
  author_user_id uuid references public.profiles(id) on delete set null,
  slug text not null unique,
  title text not null,
  version text,
  body_markdown text not null,
  tags text[] not null default '{}',
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profile_customizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  frame_key text,
  particle_key text,
  chat_color_key text,
  badge_keys text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('staff', 'admin', 'owner')
  );
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger profiles_prevent_role_escalation
before update on public.profiles
for each row execute function public.prevent_profile_role_escalation();

create trigger minecraft_account_links_set_updated_at
before update on public.minecraft_account_links
for each row execute function public.set_updated_at();

create trigger product_categories_set_updated_at
before update on public.product_categories
for each row execute function public.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create trigger entitlements_set_updated_at
before update on public.entitlements
for each row execute function public.set_updated_at();

create trigger reward_queue_set_updated_at
before update on public.reward_queue
for each row execute function public.set_updated_at();

create trigger gift_cards_set_updated_at
before update on public.gift_cards
for each row execute function public.set_updated_at();

create trigger coupons_set_updated_at
before update on public.coupons
for each row execute function public.set_updated_at();

create trigger vote_sites_set_updated_at
before update on public.vote_sites
for each row execute function public.set_updated_at();

create trigger vote_streaks_set_updated_at
before update on public.vote_streaks
for each row execute function public.set_updated_at();

create trigger support_tickets_set_updated_at
before update on public.support_tickets
for each row execute function public.set_updated_at();

create trigger updates_set_updated_at
before update on public.updates
for each row execute function public.set_updated_at();

create trigger profile_customizations_set_updated_at
before update on public.profile_customizations
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.minecraft_account_links enable row level security;
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.entitlements enable row level security;
alter table public.reward_queue enable row level security;
alter table public.gift_cards enable row level security;
alter table public.gift_card_redemptions enable row level security;
alter table public.coupons enable row level security;
alter table public.vote_sites enable row level security;
alter table public.votes enable row level security;
alter table public.vote_streaks enable row level security;
alter table public.vote_rewards enable row level security;
alter table public.webhook_events enable row level security;
alter table public.audit_logs enable row level security;
alter table public.support_tickets enable row level security;
alter table public.updates enable row level security;
alter table public.profile_customizations enable row level security;

create policy "profiles_select_own_or_admin"
on public.profiles for select
using (id = auth.uid() or public.is_admin());

create policy "profiles_update_own"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "minecraft_links_owner_access"
on public.minecraft_account_links for all
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

create policy "product_categories_public_read"
on public.product_categories for select
using (active = true or public.is_admin());

create policy "product_categories_admin_write"
on public.product_categories for all
using (public.is_admin())
with check (public.is_admin());

create policy "products_public_read"
on public.products for select
using (active = true or public.is_admin());

create policy "products_admin_write"
on public.products for all
using (public.is_admin())
with check (public.is_admin());

create policy "orders_owner_read"
on public.orders for select
using (user_id = auth.uid() or public.is_admin());

create policy "orders_owner_create_draft"
on public.orders for insert
with check (user_id = auth.uid() and status in ('draft', 'pending'));

create policy "orders_admin_write"
on public.orders for all
using (public.is_admin())
with check (public.is_admin());

create policy "order_items_owner_read"
on public.order_items for select
using (
  exists (
    select 1 from public.orders
    where orders.id = order_items.order_id
      and (orders.user_id = auth.uid() or public.is_admin())
  )
);

create policy "entitlements_owner_read"
on public.entitlements for select
using (user_id = auth.uid() or public.is_admin());

create policy "entitlements_admin_write"
on public.entitlements for all
using (public.is_admin())
with check (public.is_admin());

create policy "reward_queue_owner_read"
on public.reward_queue for select
using (user_id = auth.uid() or public.is_admin());

create policy "reward_queue_admin_write"
on public.reward_queue for all
using (public.is_admin())
with check (public.is_admin());

create policy "gift_cards_admin_only"
on public.gift_cards for all
using (public.is_admin())
with check (public.is_admin());

create policy "gift_redemptions_owner_read"
on public.gift_card_redemptions for select
using (user_id = auth.uid() or public.is_admin());

create policy "coupons_admin_only"
on public.coupons for all
using (public.is_admin())
with check (public.is_admin());

create policy "vote_sites_public_read"
on public.vote_sites for select
using (active = true or public.is_admin());

create policy "vote_sites_admin_write"
on public.vote_sites for all
using (public.is_admin())
with check (public.is_admin());

create policy "votes_owner_read"
on public.votes for select
using (user_id = auth.uid() or public.is_admin());

create policy "votes_admin_write"
on public.votes for all
using (public.is_admin())
with check (public.is_admin());

create policy "vote_streaks_owner_read"
on public.vote_streaks for select
using (user_id = auth.uid() or public.is_admin());

create policy "vote_streaks_admin_write"
on public.vote_streaks for all
using (public.is_admin())
with check (public.is_admin());

create policy "vote_rewards_owner_read"
on public.vote_rewards for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.votes
    where votes.id = vote_rewards.vote_id
      and votes.user_id = auth.uid()
  )
);

create policy "webhook_events_admin_only"
on public.webhook_events for all
using (public.is_admin())
with check (public.is_admin());

create policy "audit_logs_admin_read"
on public.audit_logs for select
using (public.is_admin());

create policy "support_tickets_owner_read"
on public.support_tickets for select
using (user_id = auth.uid() or public.is_admin());

create policy "support_tickets_public_insert"
on public.support_tickets for insert
with check (true);

create policy "support_tickets_admin_write"
on public.support_tickets for update
using (public.is_admin())
with check (public.is_admin());

create policy "updates_public_read"
on public.updates for select
using (published = true or public.is_admin());

create policy "updates_admin_write"
on public.updates for all
using (public.is_admin())
with check (public.is_admin());

create policy "profile_customizations_owner_access"
on public.profile_customizations for all
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

create index if not exists minecraft_links_user_id_idx on public.minecraft_account_links(user_id);
create index if not exists products_category_active_idx on public.products(category, active);
create index if not exists orders_user_id_created_at_idx on public.orders(user_id, created_at desc);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists entitlements_user_status_idx on public.entitlements(user_id, status);
create index if not exists entitlements_minecraft_uuid_idx on public.entitlements(minecraft_uuid);
create index if not exists reward_queue_status_available_idx on public.reward_queue(status, available_at);
create index if not exists reward_queue_minecraft_uuid_idx on public.reward_queue(minecraft_uuid);
create index if not exists votes_site_voted_at_idx on public.votes(site_id, voted_at desc);
create index if not exists votes_minecraft_username_idx on public.votes((lower(minecraft_username)));
create index if not exists vote_streaks_month_votes_idx on public.vote_streaks(month_key, monthly_votes desc);
create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at desc);
create index if not exists updates_published_at_idx on public.updates(published_at desc);

insert into public.product_categories (slug, name, description, sort_order)
values
  ('supporter', 'Supporter', 'RealVIP, RealSupporter, and cosmetic-only rank identity.', 10),
  ('cosmetics', 'Cosmetics', 'Profile effects, lobby entrances, badges, and visual unlocks.', 20),
  ('pets', 'Pets', 'Lobby and social-space pets with no gameplay impact.', 30),
  ('particles', 'Particles', 'Visual particle trails and celebration effects.', 40),
  ('identity', 'Identity', 'Username colors, chat style, profile frames, and badges.', 50),
  ('lobby', 'Lobby', 'Lobby-only convenience and social hub perks.', 60),
  ('gift-cards', 'Gift Cards', 'Store credit for safe gift purchases.', 70)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.vote_sites (slug, name, url, cooldown_hours, reward_key, sort_order)
values
  ('minecraftservers-org', 'MinecraftServers.org', 'https://minecraftservers.org', 24, 'vote.standard', 10),
  ('planetminecraft', 'PlanetMinecraft', 'https://planetminecraft.com', 24, 'vote.standard', 20),
  ('minecraft-mp', 'Minecraft-MP', 'https://minecraft-mp.com', 24, 'vote.standard', 30),
  ('topg', 'TopG', 'https://topg.org', 24, 'vote.standard', 40),
  ('minecraft-menu', 'Minecraft Menu', 'https://minecraft.menu', 24, 'vote.standard', 50),
  ('servers-minecraft', 'Servers-Minecraft', 'https://servers-minecraft.net', 24, 'vote.standard', 60),
  ('minecraft-buzz', 'Minecraft.Buzz', 'https://minecraft.buzz', 24, 'vote.standard', 70),
  ('curseforge', 'CurseForge', 'https://www.curseforge.com/minecraft/servers', 24, 'vote.standard', 80),
  ('mclist-io', 'mclist.io', 'https://mclist.io', 24, 'vote.standard', 90),
  ('mcsl', 'MCSL', 'https://minecraft-server-list.com', 24, 'vote.standard', 100)
on conflict (slug) do update set
  name = excluded.name,
  url = excluded.url,
  cooldown_hours = excluded.cooldown_hours,
  reward_key = excluded.reward_key,
  sort_order = excluded.sort_order,
  updated_at = now();
