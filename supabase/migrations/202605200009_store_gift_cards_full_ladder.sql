-- Additive seed only: completes the gift card ladder ($5/$15/$30/$75/$100)
-- alongside the $10/$20/$25/$50 cards from earlier migrations. No schema,
-- policy, or RLS changes. Keeps storefront gift-card ids in sync with
-- server-authoritative product slugs so checkout validation accepts them.

insert into public.products (slug, category, name, description, price_cents, currency, fulfillment_type, duration_days, metadata, active, featured, sort_order)
values
  ('gift-card-5',   'gift_cards', '$5 Gift Card',   'Store credit for cosmetics, supporter ranks, and visual profile perks.',   500, 'USD', 'consumable', null, '{"safe_reward":true,"gift_card_value_cents":500,"cosmetic_only":true}'::jsonb,   true, false, 75),
  ('gift-card-15',  'gift_cards', '$15 Gift Card',  'Store credit for cosmetics, supporter ranks, and visual profile perks.',  1500, 'USD', 'consumable', null, '{"safe_reward":true,"gift_card_value_cents":1500,"cosmetic_only":true}'::jsonb,  true, false, 77),
  ('gift-card-30',  'gift_cards', '$30 Gift Card',  'Store credit for cosmetics, supporter ranks, and visual profile perks.',  3000, 'USD', 'consumable', null, '{"safe_reward":true,"gift_card_value_cents":3000,"cosmetic_only":true}'::jsonb,  true, false, 82),
  ('gift-card-75',  'gift_cards', '$75 Gift Card',  'Store credit for cosmetics, supporter ranks, and visual profile perks.',  7500, 'USD', 'consumable', null, '{"safe_reward":true,"gift_card_value_cents":7500,"cosmetic_only":true}'::jsonb,  true, false, 83),
  ('gift-card-100', 'gift_cards', '$100 Gift Card', 'Store credit for cosmetics, supporter ranks, and visual profile perks.', 10000, 'USD', 'consumable', null, '{"safe_reward":true,"gift_card_value_cents":10000,"cosmetic_only":true}'::jsonb, true, false, 84)
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
