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

This is the **only** Stripe webhook route in the app. There is deliberately no
`/api/stripe/webhook` alias — a second endpoint would double-deliver events and
split the deduplication ledger. `lib/payment-invariants.test.ts` fails the build
if a second route appears or if any doc names a path that does not exist.

Subscribe it to exactly these nine events:

```
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
refund.created
refund.updated
refund.failed
charge.dispute.created
charge.dispute.closed
```

| Event | Resulting state |
| --- | --- |
| `checkout.session.completed` (payment_status `paid`) | Order paid → fulfilled |
| `checkout.session.completed` (still `unpaid`) | Stays pending; waits for the async result |
| `checkout.session.async_payment_succeeded` | Order paid → fulfilled |
| `checkout.session.async_payment_failed` | Store credit released once; order cancelled; no entitlement |
| `checkout.session.expired` | Store credit released once; unpaid order cancelled; a paid order is untouched |
| `refund.created` / `refund.updated`, status ≠ `succeeded` | Recorded only — never revokes |
| `refund.created` / `refund.updated`, status `succeeded`, **full** amount | Order revoked (refund) |
| `refund.*` succeeded, **partial** amount | `payment_reviews` manual review — never auto-revokes a whole order |
| `refund.failed` | Recorded only — access is never removed |
| `charge.dispute.created` | Order revoked (chargeback) |
| `charge.dispute.closed`, `lost` | Stays revoked (idempotent re-revoke) |
| `charge.dispute.closed`, `won` / other | Manual review — access is never auto-restored |

Payload version: the destination uses **Snapshot** payloads pinned to
`2026-04-22.dahlia`. Outgoing requests pin the same version via a
`Stripe-Version` header (`STRIPE_API_VERSION` in `lib/payments.ts`), so an
account-level version change cannot silently reshape checkout responses.

Copy the endpoint's **Signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
The verifier also rejects events whose timestamp is older than 5 minutes.

## Checkout attempt lifecycle (bounded)

Stripe prunes idempotency keys once they are roughly **24 hours** old; reusing a
pruned key creates a *new* Session instead of replaying the original. Checkout
identity is therefore explicitly time-bounded — there is no "same attempt forever"
guarantee, and the code must never imply one.

| Property | Value |
| --- | --- |
| Attempt lifetime | **1 hour** (`CHECKOUT_ATTEMPT_TTL_SECONDS`) |
| Stripe Session lifetime | **1 hour** — sent as an explicit `expires_at` |
| Retry/resume window | While the attempt is unclosed **and** unexpired |
| `after_expiration.recovery` | **Never enabled** (a recovery URL is a second payable link) |

**Identity.** The browser generates a random `checkoutAttemptId` (UUID) per
checkout intent and reuses it across retries. The server binds it to the account,
the canonical server-resolved cart (slugs, quantities, provider, store-credit
choice, gift target) and the **verified Minecraft UUID**.

**Two locks, both in Postgres:**

1. `unique (user_id, attempt_id)` — one internal order per attempt.
2. `unique (user_id, cart_fingerprint) where closed_at is null` — the
   **active-cart lock**: at most one *live* checkout per account+cart, no matter
   how many attempt UUIDs exist. This is what stops two browser tabs, or a reload
   that lost its client-side id, from opening two payable Sessions.

**What happens on retry**

- *Same attempt, still active, Session valid* → the stored Session URL is
  returned. Stripe is not called.
- *Different attempt, same cart, one already active* → the live Session is
  returned when usable; otherwise `409 checkout_already_in_progress`.
- *Attempt expired or closed* → `409 checkout_attempt_expired`. Stripe is **not**
  called with that order again, because its idempotency key may have been pruned.
  The order stays immutable and auditable.
- *Ambiguous Stripe response* → retry within the window reuses the same
  order-derived key (`realfiction-checkout:<order-id>`), so Stripe replays the
  original Session. Attachment is compare-and-set: a *different* Session can
  never replace an already-attached one.

**Starting a deliberate repeat purchase** (e.g. buying another month to stack
time) requires the previous attempt to be terminal — paid, cancelled, failed, or
expired. The client then mints a **new** `checkoutAttemptId`, which is allowed to
take the released cart lock.

**Frontend persistence.** The active `checkoutAttemptId` is kept in
`sessionStorage`, keyed to the on-screen cart, so a same-tab refresh resumes the
same checkout. It holds only a random UUID plus the cart shape — no personal data,
no secrets — and it is **not** the security boundary: the database locks are.

## Receipts vs fulfilment email

Two separate things happen on a successful payment:

1. **Stripe sends the payment receipt.** Checkout is created with
   `customer_email` and `payment_intent_data[receipt_email]`. In **live mode**
   the PaymentIntent's `receipt_email` is what causes Stripe to send the
   successful-payment receipt — it is the mechanism for this flow, not the
   Dashboard toggle. (`receipt_email` is *not* a valid top-level Checkout
   Session parameter; sending it there is silently ignored, which is why
   `lib/stripe-request-encoding.test.ts` asserts the exact form encoding.)
   Dashboard → Settings → Emails → **Successful payments** may still be enabled
   as a broad safety net for payments created outside this flow.
   Dashboard → **Refunds** should be enabled separately; Stripe owns refund
   receipts.
2. **RealFiction sends the fulfilment email.** What was bought, where it was
   delivered in-game, and when it expires. Never card data.

Stripe never emails a receipt for an unpaid or failed session, so "no receipt
for a failed order" needs no logic on our side.

### Transactional email delivery

The Stripe webhook **never calls Resend**. It writes a durable row to
`email_deliveries` inside the payment transaction and returns 2xx; a Cloudflare
Cron Trigger (`*/5 * * * *`, see `wrangler.toml`) drains the queue via the
`scheduled()` handler in `worker/index.ts`. A mail outage therefore cannot slow
a webhook, cause Stripe retries, or touch order/entitlement state.

| Cloudflare setting | Name | Notes |
| --- | --- | --- |
| **Secret** (runtime) | `RESEND_API_KEY` | Runtime only — **never** a Build variable |
| Variable (runtime) | `EMAIL_FROM` | `RealFiction <orders@realfiction.live>` |
| Variable (runtime) | `EMAIL_SUPPORT_ADDRESS` | `support@realfiction.live` |

The sending domain needs **SPF and DKIM** records for realfiction.live in
Resend, or mail lands in spam.

Without `RESEND_API_KEY` the queue is not lost: deliveries park as
`unconfigured` without consuming their attempt budget, and send once the binding
is added.

### Environment separation

`STRIPE_ENVIRONMENT` must be `live` or `test`. The webhook compares it against
`event.livemode` and **fails closed**: an unset or unrecognised value rejects
every event, and a test-mode event can never modify a production order. Rejected
events return `202` (valid signature, wrong environment) so Stripe stops
retrying while no work is performed.

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
7. Refund the test payment in full in Stripe → `refund.created`/`refund.updated`
   fires with status `succeeded` → the order is marked refunded and a
   compensating revoke reward is queued. A *partial* refund is deliberately not
   auto-revoked: it lands in `payment_reviews` for a human.
8. Check Stripe → Developers → Webhooks → your endpoint shows `200` responses.
   A `401` means `STRIPE_WEBHOOK_SECRET` is wrong or from the other mode; a `503`
   means the runtime secrets/migrations are not in place yet.
