# RealFiction Platform Architecture

RealFiction is now structured as a Cloudflare Pages compatible Next.js App Router platform with Supabase Auth/Postgres/RLS, first-party cosmetic store checkout, vote ingestion, account linking, webhook persistence, and reward queue persistence.

## Current Stack

- Frontend: Next.js App Router, TypeScript, TailwindCSS, Framer Motion, shadcn-style owned UI primitives.
- Hosting target: Cloudflare Pages through OpenNext for Cloudflare.
- API runtime: Next route handlers built for the Cloudflare Worker runtime.
- Auth/database: Supabase Auth and PostgreSQL with RLS enabled on application tables.
- Payments: Stripe Checkout and PayPal Checkout. RealFiction never stores raw card data.
- Minecraft integration target: `RealCore`, a future Purpur/Folia/Paper plugin using signed backend calls.
- Permissions target: LuckPerms for ranks, prefixes, suffixes, chat colors, lobby permissions, and cosmetic permission grants.

## Trust Boundaries

- Browser clients can read public content and submit checkout/link/contact requests.
- Browser clients cannot directly verify Minecraft links, create paid orders as fulfilled, create entitlements, create reward queue rows, write vote logs, write webhook events, or mutate roles/balances/server-owned identity fields.
- The Supabase service role is isolated in `lib/supabase/service-role.ts`, which imports `server-only`.
- User session Supabase access lives in `lib/supabase/server.ts`, also server-only.
- Payment and vote fulfillment happen only after server-side validation.
- Webhooks are persisted before processing and keyed by provider event id.
- Rewards are queued, not granted directly from checkout or vote routes.

## Implemented Routes

- `GET /api/player-count`: reads network player count from a status provider.
- `POST /api/contact`: persists a support ticket via the service role, with a honeypot field and a per-IP DB-backed rate limit.
- `POST /api/account/link/start`: authenticated user starts a Minecraft link request; the code is generated and hashed server-side.
- `POST /api/store/checkout`: validates cart items against database products, creates a pending local order, then creates Stripe or PayPal checkout.
- `GET /api/store/paypal/capture`: captures a PayPal checkout return and only fulfills if the returned PayPal order references the same local order id.
- `POST /api/webhooks/stripe`: verifies Stripe signatures, persists webhook events, fulfills paid orders idempotently, and revokes orders on `charge.refunded` / `charge.dispute.created`.
- `POST /api/webhooks/paypal`: verifies PayPal webhook transmission, persists webhook events, fulfills paid orders idempotently, and revokes orders on refund/reversal/dispute events.
- `POST /api/vote`: accepts RealCore/RealVoteBridge HMAC auth via `REALCORE_PLUGIN_SECRET`; optional legacy `VOTE_WEBHOOK_SECRET` fallback is supported for old vote callbacks. It persists vote logs, updates streaks atomically, queues the vote reward, and queues monthly milestone rewards.
- `POST /api/rewards/claim`: authenticated owner-only; expedites delivery of the user's own pending reward. Plugin delivery transitions live in `/api/plugin/rewards/poll` and `/api/plugin/rewards/ack`.
- `POST /api/plugin/account-link/confirm`: RealCore-facing account link confirmation with plugin auth.
- `POST /api/plugin/rewards/poll`: plugin-authenticated atomic reward polling and claiming.
- `POST /api/plugin/rewards/ack`: plugin-authenticated idempotent delivery acknowledgement.

## Database State

The base schema is in `supabase/migrations/202605200001_realfiction_platform.sql`.

The hardening migration is in `supabase/migrations/202605200002_security_hardening.sql` and adds:

- `profile_settings` for user-writable profile fields.
- Hashed Minecraft verification codes through `minecraft_account_links.verification_code_hash`.
- Link status support for `pending`, `verified`, `expired`, and `revoked`.
- Unique verified Minecraft username/UUID indexes by platform.
- `votes.idempotency_key` and a unique partial index.
- Idempotent entitlement creation by `order_item_id` and `entitlement_key`.
- Safe cosmetic/supporter product seed data.
- `public.fulfill_paid_order(order_id)` for service-role-only order fulfillment.
- Stricter RLS policies on profiles, links, orders, entitlements, rewards, votes, webhooks, gift cards, coupons, and support tickets.

The RealCore delivery migration is in `supabase/migrations/202605200003_realcore_delivery.sql` and adds:

- Reward claim fields: `claimed_at`, `claimed_by_server`, and `last_error`.
- `plugin_request_nonces` for HMAC replay protection.
- `public.poll_reward_queue(server_id, server_group, limit)` for service-role-only atomic queue claims.
- `public.ack_reward_delivery(reward_id, server_id, status, failure_reason)` for service-role-only idempotent delivery acknowledgement.

The nonce cleanup migration is in `supabase/migrations/202605200004_plugin_nonce_cleanup.sql` and adds `public.cleanup_plugin_request_nonces()` (service-role only) to prune expired replay nonces. Scheduling (pg_cron or an external cron) is per-environment and documented inline.

The refund/chargeback migration is in `supabase/migrations/202605200005_refund_chargeback.sql` and adds `public.revoke_order(order_id, mode, reason)` (service-role only): it transitions the order and its entitlements to refunded/revoked, cancels undelivered grant rewards, queues compensating revoke rewards, and writes an audit log row.

The support anti-spam migration is in `supabase/migrations/202605200006_support_tickets_antispam.sql` and adds `support_tickets.ip_hash` plus an index for per-IP rate limiting.

The vote streak migration is in `supabase/migrations/202605200007_vote_streaks.sql` and adds `public.apply_vote_streak(...)` (service-role only) for atomic streak/counter accounting.

## RLS Model

Public read:

- Active product categories.
- Active products.
- Active vote sites.
- Published updates.

Owner read:

- Own profile.
- Own Minecraft account links.
- Own orders and order items.
- Own entitlements.
- Own reward queue rows.
- Own votes, vote streaks, vote rewards, support tickets, and profile customizations.

Owner write:

- `profile_settings`.
- `profile_customizations`.

Server/admin write only:

- `profiles` server-owned identity fields and roles.
- `minecraft_account_links` status, UUID, verification fields, and timestamps.
- `orders`, `order_items`, `entitlements`, `reward_queue`.
- `plugin_request_nonces`.
- `gift_cards`, `gift_card_redemptions`, `coupons`.
- `votes`, `vote_streaks`, `vote_rewards`.
- `webhook_events`, `audit_logs`.

Supabase `service_role` bypasses RLS and is used only from server-only route modules.

RLS tests live in `supabase/tests/database/rls_security.test.sql` and run through `npm run test:rls`.

## Account Linking

Implemented flow:

1. Signed-in user calls `POST /api/account/link/start` with `minecraftUsername` and `platform`.
2. Server ensures the profile exists.
3. Server refuses to overwrite already verified or revoked links.
4. Server generates an 8-character verification code and stores only a SHA-256 hash.
5. Server returns the short-lived code and the future command form: `/realfiction link CODE`.
6. RealCore will receive the in-game command and call `POST /api/plugin/account-link/confirm` with plugin auth, code, UUID, username, and platform.
7. Verify route expires old pending links, matches the hash, writes UUID/status/verified timestamp, clears the hash, and updates the profile primary Minecraft fields.

The website user cannot self-verify a Minecraft account.

## Store And Checkout

Implemented flow:

1. Browser submits provider, cart lines, optional Minecraft username, and optional gift recipient.
2. Server requires a signed-in user or a Minecraft delivery target.
3. Server loads products from Supabase by slug and validates active status, category, price, fulfillment type, quantity, and duration.
4. Server rejects non-cosmetic/non-supporter categories and blocked gameplay-advantage metadata.
5. Server creates a pending local `orders` row and `order_items` snapshots before contacting a payment provider.
6. Stripe Checkout gets `client_reference_id`, checkout metadata, and payment intent metadata containing the local order id.
7. PayPal Checkout gets local order id in `reference_id`, `custom_id`, and `invoice_id`.
8. Checkout routes return only a provider URL and local order id.

Checkout routes do not grant rewards.

## Webhook Fulfillment

Stripe and PayPal webhook routes:

- Verify provider authenticity.
- Insert into `webhook_events` with `(provider, provider_event_id)` uniqueness.
- Short-circuit only duplicates that were already fully processed (`processed_at` set). A duplicate whose prior attempt failed before fulfillment re-drives the idempotent fulfillment instead of being silently dropped.
- Resolve the local order id from provider metadata/reference fields.
- Mark the local order paid.
- Call `public.fulfill_paid_order(order_id)`.
- Mark the webhook event processed only after fulfillment succeeds.

`fulfill_paid_order` locks the order, creates entitlements and reward queue rows with idempotency keys, then marks the order fulfilled. Replayed webhooks do not create duplicate rewards.

## Vote Flow

Implemented flow:

1. Vote sites send public vote traffic only to Velocity NuVotifier.
2. `RealVoteBridge` listens on Velocity and forwards the vote to `/api/vote`.
3. `/api/vote` accepts RealCore-style HMAC plugin auth, with the legacy shared vote secret kept only for staging compatibility.
4. Server validates site, username, vote token, timestamp, and optional address hash.
5. Server resolves an active vote site, including NuVotifier service-name aliases.
6. Server matches a verified Java Minecraft link when available.
7. Vote is persisted with a hashed idempotency key.
8. Duplicate votes with the same idempotency key return accepted duplicate.
9. Streak counters update atomically through `apply_vote_streak` (current/longest/monthly/total with gap-based reset).
10. A safe vote reward is placed into `reward_queue` and linked through `vote_rewards`.
11. When monthly votes hit a milestone (5, 15, 30, 75), a safe milestone reward is queued with a per-month idempotency key.

Vote routes do not grant rewards directly.

## Reward Delivery

Implemented user claim behavior:

- User `claim` requires Supabase authentication and ownership of the reward row.
- Repeated delivered claims return an idempotent duplicate response.

Implemented plugin delivery behavior:

- RealCore authenticates with HMAC headers. Shared-secret auth is opt-in via `REALCORE_ALLOW_SHARED_SECRET` for staging/bootstrap only and is rejected in production.
- HMAC requests store nonce hashes in `plugin_request_nonces` and reject replays.
- Polling claims pending rows atomically and returns minimal Minecraft delivery payloads.
- Acknowledgement marks rows delivered/failed idempotently.
- Queue states support `pending`, `processing`, `delivered`, `failed`, and `cancelled`.

Refund and chargeback handling is implemented: Stripe/PayPal refund, dispute, and reversal webhooks call `revoke_order`, which transitions entitlements, cancels undelivered grants, and queues compensating revoke rewards (`delivery.action = "revoke"`). Gift-card store-credit clawback is the remaining refund case.

Still needed:

- Retry backoff worker and failed-row replay tooling.
- Gift-card store-credit clawback on refund.

## Environment Variables

Client-safe:

```text
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Server-only:

```text
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET
PAYPAL_WEBHOOK_ID
PAYPAL_ENVIRONMENT
VOTE_WEBHOOK_SECRET (optional legacy vote callback fallback)
REALCORE_PLUGIN_SECRET
REALCORE_ALLOW_SHARED_SECRET
PLAYER_COUNT_ENDPOINT
```

Server-only values must not be imported into client components.

## No Pay-To-Win Rule

Current seeded products are limited to:

- RealVIP supporter rank.
- RealSupporter supporter status.
- Pets.
- Particles.
- Username colors.
- Lobby flight.
- Cosmetic bundles.
- Gift cards for the cosmetic/supporter store.

No paid kits, combat perks, economy multipliers, PvP advantages, claim advantages, or server-balance advantages are seeded or accepted by the checkout validator.

## Remaining Platform Work

- Wire Supabase Auth UI into the account dashboard.
- Add product/catalog API reads from Supabase instead of static storefront data.
- Add admin product/update/support tooling.
- Apply the Cloudflare rate limiting / abuse rules per `docs/CLOUDFLARE_RATELIMIT.md` at deploy time.
- Apply and test migrations in a staging Supabase project before production cutover.
