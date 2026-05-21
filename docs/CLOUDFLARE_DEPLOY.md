# Cloudflare Deployment & Environment Variables

RealFiction deploys as a **Cloudflare Worker** (not Pages) via OpenNext.

## Build & deploy configuration

These live in `wrangler.toml` and `package.json` and should not need dashboard changes:

- `main = ".open-next/worker.js"`, `[assets] directory = ".open-next/assets"`, `compatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]`.
- `[build] command = "npm run build:cloudflare"` — produces `.open-next/`.
- Deploy runs `wrangler deploy`, which OpenNext intercepts as `opennextjs-cloudflare deploy`.

> Do **not** set the build command to `npm run build`. `opennextjs-cloudflare build`
> invokes the package `build` script internally, so `build` must remain `next build`
> (otherwise the build recurses infinitely). Use `build:cloudflare` for the build step.

## Environment variables

There are **two classes**. Set them in the dashboard under
**Workers & Pages → realfiction → Settings → Variables and Secrets**.

### 1. Build-time variables (`NEXT_PUBLIC_*`)

Next.js inlines `NEXT_PUBLIC_*` values **at build time**, so these must be present
during the Cloudflare build (build variables), not only at runtime.

| Variable | Purpose | Already in wrangler.toml |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL (checkout return URLs) | yes (`[vars]`) |
| `NEXT_PUBLIC_MINECRAFT_SERVER` | Java host for live player count | yes (`[vars]`) |
| `NEXT_PUBLIC_BEDROCK_SERVER` | Bedrock host (display) | yes (`[vars]`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser auth (sign in / account) | **no — add it** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser auth (sign in / account) | **no — add it** |

Without the two Supabase `NEXT_PUBLIC_*` values at build time, the account
sign-in UI stays disabled (the header simply shows **Sign in** and the form is
inert). Everything else still renders.

### 2. Runtime secrets (server-only, encrypted)

Add these as **Secrets** (encrypted) on the Worker. They are read only by server
route handlers and never reach the browser.

| Secret | Powers |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Order/entitlement/reward writes, webhooks, plugin endpoints |
| `STRIPE_SECRET_KEY` | Stripe checkout creation |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | PayPal checkout + capture |
| `PAYPAL_WEBHOOK_ID` | PayPal webhook verification |
| `PAYPAL_ENVIRONMENT` | `sandbox` or `live` (config, not secret) |
| `VOTE_WEBHOOK_SECRET` | Vote callback authentication |
| `REALCORE_PLUGIN_SECRET` | RealCore HMAC plugin auth |
| `REALCORE_ALLOW_SHARED_SECRET` | Leave **unset** in production (HMAC only) |

`PLAYER_COUNT_ENDPOINT` is **not** required — the player count uses the public
`mcsrvstat.us` API keyed off `NEXT_PUBLIC_MINECRAFT_SERVER`.

## Graceful degradation (no secrets set)

The site builds and deploys with **zero** secrets. Until each is configured:

- Home, store browsing, vote list, map, rules, updates, contact, Discord: **work**.
- Live player count: **works** (public API).
- Account sign in / sign up: needs the two `NEXT_PUBLIC_SUPABASE_*` build vars.
- Checkout (card/PayPal): shows a friendly "payments unavailable" message until
  Supabase + Stripe/PayPal are set.
- Webhooks, vote callback, plugin endpoints: reject requests until their secrets
  are set (safe default — no traffic is processed without verification).

## Provider wiring (after secrets are set)

- Stripe webhook endpoint → `https://realfiction.live/api/webhooks/stripe`; the
  signing secret must equal `STRIPE_WEBHOOK_SECRET`.
- PayPal webhook endpoint → `https://realfiction.live/api/webhooks/paypal`; the
  webhook id must equal `PAYPAL_WEBHOOK_ID`.
- See `docs/STAGING_SUPABASE_CHECKLIST.md` for migrations and
  `docs/CLOUDFLARE_RATELIMIT.md` for WAF / rate-limit rules.
