# Payments: test → live runbook

The store checkout is **fully built in code** (`lib/payments.ts`,
`app/api/store/checkout/route.ts`, `app/api/store/paypal/capture/route.ts`,
`app/api/webhooks/stripe/route.ts`, `app/api/webhooks/paypal/route.ts`). Turning
it on is purely configuration: set the secrets on the Cloudflare `realfiction`
Worker and point the provider webhooks at the deployed URLs.

- **Card, Apple Pay, Google Pay → Stripe Checkout.** Apple Pay and Google Pay
  appear automatically in Stripe's hosted Checkout on supported devices — no
  extra code or buttons.
- **PayPal → PayPal Orders v2** (create + capture).

See `docs/STRIPE_SETUP.md` for the Stripe-account specifics (incl. the warning
not to reuse the Ko‑fi-managed account).

## Environment variables (Cloudflare Worker → Settings → Variables and Secrets)

| Variable | Type | Test value | Live value |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | Secret | `sk_test_…` | `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | Secret | test endpoint `whsec_…` | live endpoint `whsec_…` |
| `PAYPAL_CLIENT_ID` | Secret | sandbox app id | live app id |
| `PAYPAL_CLIENT_SECRET` | Secret | sandbox app secret | live app secret |
| `PAYPAL_WEBHOOK_ID` | Variable | sandbox webhook id | live webhook id |
| `PAYPAL_ENVIRONMENT` | Variable | `sandbox` | `production` (also accepts `live`) |
| `NEXT_PUBLIC_SITE_URL` | Variable | already set → `https://realfiction.live` | same |

`STRIPE_*` / `PAYPAL_CLIENT_*` hold credentials → store as **encrypted
Secrets** (like `SUPABASE_SERVICE_ROLE_KEY`). After changing any of them,
**redeploy** the Worker so the new values are picked up.

## Webhook endpoints

Both must be reachable publicly and have their signing identifier configured, or
**paid orders will not be fulfilled** (the checkout succeeds but the reward never
delivers).

**Stripe** → Developers → Webhooks → Add endpoint
`https://realfiction.live/api/webhooks/stripe`, events:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `charge.refunded`
- `charge.dispute.created`

Copy the endpoint's **Signing secret** → `STRIPE_WEBHOOK_SECRET`.

**PayPal** → your app → Webhooks → Add `https://realfiction.live/api/webhooks/paypal`,
events:
- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.REFUNDED`
- `PAYMENT.CAPTURE.REVERSED`

Copy the **Webhook ID** → `PAYPAL_WEBHOOK_ID`.

## Step 1 — Test / sandbox (do this first)

1. Stripe (Test mode toggle ON): copy `sk_test_…` → `STRIPE_SECRET_KEY`.
   Add the **test** webhook endpoint above → `STRIPE_WEBHOOK_SECRET`.
2. PayPal Developer Dashboard → **Sandbox** app: copy id/secret →
   `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`. Add the **sandbox** webhook →
   `PAYPAL_WEBHOOK_ID`. Keep `PAYPAL_ENVIRONMENT=sandbox`.
3. Redeploy the Worker.
4. Run a full fake purchase end-to-end (see Verification). Cards never charge in
   test mode; PayPal uses a sandbox buyer account.

### Verification (test mode)

- On `/store`, add an item, enter a Minecraft username (or sign in), and click
  **Checkout** → you should land on Stripe Checkout. Pay with test card
  `4242 4242 4242 4242`, any future expiry, any CVC/ZIP. Apple/Google Pay should
  also appear on a supported device.
- Click **Pay with PayPal** → you should land on the PayPal sandbox approval
  page; approve with a sandbox buyer.
- After each, confirm the order moves to fulfilled (account page → Recent
  Purchases) — this proves the **webhook** path works. If it stays pending, the
  webhook secret/id or the endpoint URL is wrong.
- Test a refund from each dashboard and confirm the entitlement is revoked.

## Step 2 — Go live (after test passes)

1. Swap the four secrets to their **live** values (`sk_live_…`, live PayPal
   app id/secret) and add **live** webhook endpoints (new signing secret +
   webhook id).
2. Set `PAYPAL_ENVIRONMENT=production`.
3. Stripe → Settings → Payment methods: enable **Apple Pay** and **Google Pay**,
   and register the domain `realfiction.live` for Apple Pay.
4. Redeploy. Do one small **real** purchase of each type and refund it to
   confirm the live path + payouts.

## Notes

- Until a provider's keys are set, its button returns a friendly
  *"… payments are not ready yet"* (HTTP 503) — expected.
- Prices are server-side (`lib/store-server.ts` resolves them from the DB), so a
  tampered client cart can't change what's charged.
