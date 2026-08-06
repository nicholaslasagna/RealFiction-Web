# Store banners

The wide product banners shown on the storefront cards, in the cart, and on the
account page. These are the **same files uploaded to the Stripe product
catalog**, so a customer sees identical artwork on realfiction.live and on the
Stripe checkout page.

## Files

One PNG per subscription product, named after its product `id` in `lib/data.ts`:

| File | Product | Panel colour |
| --- | --- | --- |
| `realvip.png` | RealVIP | `#D065B9` |
| `real-supporter.png` | RealSupporter | `#00EB00` |
| `cosmetic-atelier.png` | Cosmetic Atelier | `#4709F1` |
| `realpets.png` | RealPets Pack | `#08A19E` |
| `particle-vault.png` | Particle Vault | `#00D1F9` |
| `username-colors.png` | Username Colors | `#FF0000` |
| `lobby-flight.png` | Lobby Flight | `#F6F400` |

`lib/store-banners.test.ts` fails the build if any of these is missing, so the
store can never ship with broken art.

## Spec

- **1825 × 414** (ratio ~4.41). Declared once as `STORE_BANNER_WIDTH` /
  `STORE_BANNER_HEIGHT` in `lib/data.ts`; the banners always render
  `h-auto w-full`, so the ratio is what matters. Keep all seven identical or the
  product cards will look ragged next to each other.
- Layout: dark icon panel on the left ~30%, solid brand colour on the right with
  the product name in condensed bold.
- PNG, currently 49–67 KB each. A 400 KB per-file cap is enforced by test —
  these load on three different pages.

## Replacing one

Overwrite the file and keep the name. If the new art has different dimensions,
update `STORE_BANNER_WIDTH` / `STORE_BANNER_HEIGHT` in `lib/data.ts` to match, or
next/image will reserve the wrong aspect box while loading.

Gift-card artwork is separate: `public/images/giftcard-*.png`, referenced by the
`image` field on each gift card in `lib/data.ts`.
