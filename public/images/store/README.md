# Store banners

The wide product banners for the storefront, cart, and account page. These are
the **same files uploaded to the Stripe product catalog**, so a customer sees
identical artwork on realfiction.live and on the Stripe checkout page.

## Required files

One PNG per subscription product, named after its product `id` in `lib/data.ts`:

| File | Product |
| --- | --- |
| `realvip.png` | RealVIP |
| `real-supporter.png` | RealSupporter |
| `cosmetic-atelier.png` | Cosmetic Atelier |
| `realpets.png` | RealPets Pack |
| `particle-vault.png` | Particle Vault |
| `username-colors.png` | Username Colors |
| `lobby-flight.png` | Lobby Flight |

`lib/store-banners.test.ts` fails the build if any of these is missing, so the
store can never ship with broken art.

## Export spec

- **Aspect ratio ~4.6:1** (the code declares 1850×400). Any consistent wide
  ratio works — banners always render `h-auto w-full` — but keep all seven the
  same, or the cards will look ragged next to each other.
- PNG, transparent background not required.
- Keep each file well under ~200 KB. These load on the store page, the cart, and
  the account page; the gift-card PNGs in `public/images/` are 300–450 KB each
  and are already heavier than they should be. Run them through an optimiser
  (e.g. `pngquant`) before committing.

Gift-card artwork is separate and lives in `public/images/giftcard-*.png`,
referenced by the `image` field on each gift card.
