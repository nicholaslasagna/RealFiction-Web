-- Additive seed only: adds $10/$20/$50 gift card products alongside the existing
-- $25 gift card seeded in 202605200002. No schema, policy, or RLS changes.
-- Keeps storefront gift-card ids in sync with server-authoritative product slugs
-- so checkout validation accepts them.

insert into public.products (slug, category, name, description, price_cents, currency, fulfillment_type, duration_days, metadata, active, featured, sort_order)
values
  (
    'gift-card-10',
    'gift_cards',
    '$10 Gift Card',
    'Store credit for cosmetics, supporter ranks, and visual profile perks.',
    1000,
    'USD',
    'consumable',
    null,
    '{"safe_reward":true,"gift_card_value_cents":1000,"cosmetic_only":true}'::jsonb,
    true,
    false,
    78
  ),
  (
    'gift-card-20',
    'gift_cards',
    '$20 Gift Card',
    'Store credit for cosmetics, supporter ranks, and visual profile perks.',
    2000,
    'USD',
    'consumable',
    null,
    '{"safe_reward":true,"gift_card_value_cents":2000,"cosmetic_only":true}'::jsonb,
    true,
    false,
    79
  ),
  (
    'gift-card-50',
    'gift_cards',
    '$50 Gift Card',
    'Store credit for cosmetics, supporter ranks, and visual profile perks.',
    5000,
    'USD',
    'consumable',
    null,
    '{"safe_reward":true,"gift_card_value_cents":5000,"cosmetic_only":true}'::jsonb,
    true,
    false,
    81
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
