# Stripe Setup (RealFiction)

How to connect Stripe to RealFiction's store checkout. This is a configuration
guide only — the integration is already built in code
(`lib/payments.ts` and `app/api/webhooks/stripe/route.ts`). No app changes are
needed to enable Stripe.

## Use a dedicated RealFiction Stripe account (not Ko-fi's)

The Stripe account connected to **Ko-fi** is a separate, Ko-fi-managed Connect
account. It exists to receive Ko-fi tips and shows the `KO-FI.COM` statement
descriptor. **Do not use it for RealFiction checkout:**

- RealFiction calls the Stripe API with its own secret key and verifies webhooks
  with its own signing secret — a Ko-fi-managed flow does not cleanly provide
  these.
- Reusing it would put `KO-FI.COM` on players' card statements and mix two
  businesses' payouts, refunds, and disputes.

Create a separate account for RealFiction at
[dashboard.stripe.com](https://dashboard.stripe.com) (use the account switcher →
"New account"). Finish the Ko-fi onboarding only if you actually want Ko-fi tips.

## What the code requires

Two server-only secrets, read at request time:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | `lib/payments.ts` | Bearer token to create Checkout Sessions (`sk_test_…` / `sk_live_…`). |
| `STRIPE_WEBHOOK_SECRET` | `app/api/webhooks/stripe/route.ts` | Verifies the `stripe-signature` header (`whsec_…`). |

Payment flow: store checkout creates a pending local order → Stripe Checkout →
webhook verifies the signature → `fulfill_paid_order` creates entitlements and
queues rewards → RealCore polls and delivers. Refunds/chargebacks revoke the
order.

### These go in the Cloudflare Worker RUNTIME secrets, not Build variables

Cloudflare Workers Builds keeps **build** variables and **runtime** variables
separate. API routes read `process.env` at request time, so both Stripe secrets
must live in the **runtime** list:

- Cloudflare → Workers & Pages → `realfiction` → Settings → **Variables and
  Secrets** (the first card, *"…used at runtime"*) — **not** the list under
  **Build**.
- Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as **Secret** type.
- **Re-deploy** the Worker afterward — runtime secret changes only take effect on
  a new version.

(`NEXT_PUBLIC_*` values are the opposite: they belong in the Build list so they
get inlined at build time.)

## No Stripe Products or Prices to create

The checkout builds **dynamic** Checkout Sessions using `price_data` generated
from RealFiction's own `products` table (name, description, price, currency,
metadata). You do **not** create a product catalog or Price objects in the Stripe
dashboard — leave Products empty.

## Webhook endpoint

Create one webhook endpoint in Stripe pointing at:

```
https://realfiction.live/api/webhooks/stripe
```

Subscribe it to exactly these events:

```
checkout.session.completed
checkout.session.async_payment_succeeded
charge.refunded
charge.dispute.created
```

- `checkout.session.completed` / `checkout.session.async_payment_succeeded` →
  marks the order paid and fulfills it.
- `charge.refunded` → revokes the order (refund).
- `charge.dispute.created` → revokes the order (chargeback).

Copy the endpoint's **Signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
The verifier also rejects events whose timestamp is older than 5 minutes.

## Test mode setup (no real money)

1. dashboard.stripe.com → RealFiction account → toggle **Test mode** (top right).
2. Developers → **API keys** → copy the **Secret key** (`sk_test_…`).
3. Developers → **Webhooks** → **Add endpoint**:
   - URL: `https://realfiction.live/api/webhooks/stripe`
   - Events: the four listed above
   - Copy the test **Signing secret** (`whsec_…`).
4. Cloudflare runtime **Variables and Secrets** (Secret type):
   - `STRIPE_SECRET_KEY` = `sk_test_…`
   - `STRIPE_WEBHOOK_SECRET` = `whsec_…` (from the test endpoint)
5. **Re-deploy** the Worker.

## Live mode setup (real payments)

1. Complete Stripe account activation (business details + bank).
2. Switch to **Live mode**.
3. Developers → API keys → copy the **live** Secret key (`sk_live_…`).
4. Developers → Webhooks → **Add endpoint** again (live mode is a separate
   endpoint): same URL, same four events → copy the **live** Signing secret.
5. Update the Cloudflare runtime secrets:
   - `STRIPE_SECRET_KEY` = `sk_live_…`
   - `STRIPE_WEBHOOK_SECRET` = the live `whsec_…`
6. **Re-deploy** the Worker.

> Keep test and live values matched. A `sk_test_` key paired with a live
> endpoint's `whsec_` (or vice versa) causes webhook signature failures (HTTP
> 401) even though checkout itself appears to work.

## Testing checklist (test mode)

1. Open `/store`, add an item, choose **Pay with card**.
2. On Stripe Checkout use test card `4242 4242 4242 4242`, any future expiry, any
   CVC, any ZIP.
3. Confirm redirect back to `/account?checkout=success`.
4. In Supabase, the `orders` row moves `pending` → `paid` → `fulfilled`.
5. A `reward_queue` row is created for the purchase.
6. RealCore polls and delivers it in-game; the reward acknowledges as delivered.
7. Refund the test payment in Stripe → `charge.refunded` fires → the order is
   marked refunded and a compensating revoke reward is queued.
8. Check Stripe → Developers → Webhooks → your endpoint shows `200` responses.
   A `401` means `STRIPE_WEBHOOK_SECRET` is wrong or from the other mode; a `503`
   means the runtime secrets/migrations are not in place yet.
