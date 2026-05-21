-- Move the non-gift store to a subscription model: every product offers
-- 1 / 3 / 6 / 12-month tiers (each its own server-authoritative slug, priced and
-- duration-bound). No permanent products remain. Gift cards are unchanged.

-- 1) Retire the old permanent/monthly products so they can't be purchased.
update public.products
set active = false,
    updated_at = now()
where slug in (
  'realvip-monthly',
  'real-supporter',
  'realpets-pack',
  'particle-vault',
  'username-colors',
  'lobby-flight',
  'cosmetic-atelier'
);

-- 2) Seed the subscription SKUs (7 products x 4 durations).
with bases (base, ord, display, category, lp_group, lp_perm, cosmetic_type, lobby_only, p1, p3, p6, p12) as (
  values
    ('realvip',          110, 'RealVIP',          'supporter',  'realvip',       null,                            null,         false, 499, 1299, 2399, 3999),
    ('real-supporter',   120, 'RealSupporter',    'supporter',  'realsupporter', null,                            null,         false, 999, 2699, 4799, 7999),
    ('realpets',         130, 'RealPets Pack',    'pets',       null,            'realfiction.pets.pack',         'pets',       false, 299,  799, 1399, 2399),
    ('particle-vault',   140, 'Particle Vault',   'particles',  null,            'realfiction.particles.vault',   'particles',  false, 349,  899, 1699, 2799),
    ('username-colors',  150, 'Username Colors',  'identity',   null,            'realfiction.username.colors',   'chat_color', false, 199,  499,  899, 1599),
    ('lobby-flight',     160, 'Lobby Flight',     'lobby',      null,            'realfiction.lobby.flight',      null,         true,  249,  649, 1199, 1999),
    ('cosmetic-atelier', 170, 'Cosmetic Atelier', 'cosmetics',  null,            'realfiction.cosmetics.atelier', 'bundle',     false, 699, 1899, 3399, 5599)
),
terms (months, ord, suffix, label, duration_days) as (
  values
    (1,  1, '1m',  '1 Month',  30),
    (3,  2, '3m',  '3 Months', 90),
    (6,  3, '6m',  '6 Months', 180),
    (12, 4, '12m', '1 Year',   365)
)
insert into public.products (
  slug, category, name, description, price_cents, currency, fulfillment_type,
  duration_days, metadata, active, featured, sort_order
)
select
  b.base || '-' || t.suffix,
  b.category::public.product_category,
  b.display || ' — ' || t.label,
  b.display || ' for ' || t.label || '. Cosmetic-only, no gameplay advantages.',
  case t.months when 1 then b.p1 when 3 then b.p3 when 6 then b.p6 else b.p12 end,
  'USD',
  'subscription'::public.product_fulfillment_type,
  t.duration_days,
  jsonb_strip_nulls(jsonb_build_object(
    'safe_reward', true,
    'cosmetic_only', true,
    'luckperms_group', b.lp_group,
    'luckperms_permission', b.lp_perm,
    'cosmetic_type', b.cosmetic_type,
    'lobby_only', case when b.lobby_only then true else null end,
    'duration_months', t.months
  )),
  true,
  false,
  b.ord + t.ord
from bases b
cross join terms t
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
