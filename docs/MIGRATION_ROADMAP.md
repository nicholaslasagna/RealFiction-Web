# Migration Roadmap

## Phase 1: Platform Shell Complete

- Next.js App Router structure is in place.
- Home, Store, Vote, Account, Map, Rules, Updates, Discord, and Contact pages exist.
- Cloudflare Pages/OpenNext configuration exists.
- Supabase base migration exists.
- Cosmetic-only static storefront exists.

## Phase 2: Security Foundation Complete

Implemented in `supabase/migrations/202605200002_security_hardening.sql` and current API routes:

- Service-role Supabase access moved behind `server-only`.
- User-writable profile settings split from server-owned profile identity fields.
- Authenticated account link start route added.
- Plugin-authorized account link confirm route (HMAC + nonce); the legacy shared-secret verify route was retired.
- Verification codes are generated server-side and stored as hashes.
- Verified and revoked links are not overwritten by user start requests.
- Checkout creates pending local orders before Stripe or PayPal sessions.
- Checkout validates products, categories, quantities, duration, and safe metadata server-side.
- Stripe and PayPal webhooks persist events and process duplicates safely.
- Paid orders fulfill through a service-role-only SQL function.
- Vote webhook secret is required.
- Votes persist with idempotency keys and queue rewards.
- User reward claims require account ownership; plugin delivery transitions use the atomic `/api/plugin/rewards/poll` and `/api/plugin/rewards/ack` routes.

## Phase 3: Staging Supabase Validation

Current state:

- Staging checklist added in `docs/STAGING_SUPABASE_CHECKLIST.md`.
- Supabase CLI config added in `supabase/config.toml`.
- RLS/security pgTAP tests added in `supabase/tests/database/rls_security.test.sql`.
- `npm run test:rls` added for local database policy tests.

Next required work:

- Apply all four migrations to a staging Supabase project.
- Run Supabase database linting against the deployed schema.
- Run RLS tests against a disposable local or branch database.
- Verify seeded product slugs match storefront product ids.
- Verify `fulfill_paid_order`, `poll_reward_queue`, and `ack_reward_delivery`.
- Add staging webhook fixtures for Stripe and PayPal.

## Phase 4: Auth And Account Dashboard

- Wire Supabase Auth login/signup in the account dashboard.
- Display link status from `minecraft_account_links`.
- Show pending verification command and expiration.
- Display order history, entitlements, reward queue status, and vote history from owner-readable tables.
- Keep profile identity fields read-only in the UI.

## Phase 5: RealCore Staging

Current website state:

- `POST /api/plugin/account-link/confirm` exists.
- `POST /api/plugin/rewards/poll` exists.
- `POST /api/plugin/rewards/ack` exists.
- HMAC plugin auth with timestamp and server-id-bound signing plus nonce replay protection exists.
- Shared-secret plugin auth is opt-in via `REALCORE_ALLOW_SHARED_SECRET` (staging/bootstrap only; off in production).

Next plugin work:

- Build the Java plugin scaffold.
- Add signed API client using HMAC with `REALCORE_PLUGIN_SECRET`.
- Implement `/realfiction link CODE` command.
- Call `/api/plugin/account-link/confirm` from the plugin.
- Poll `/api/plugin/rewards/poll` and ack `/api/plugin/rewards/ack`.
- Implement LuckPerms grants, expirations, and rollback handling.
- Test with staging products and staged vote rewards.

## Phase 6: Store Replacement

- Export Tebex products, packages, gift cards, customers, active subscriptions, and grant history.
- Map Tebex packages to first-party `products`.
- Import active customer ownership as historical orders and entitlements.
- Run a dual-read window where existing Tebex grants are honored while new purchases go through RealFiction.
- Test Stripe and PayPal sandbox checkout and webhook replay.
- Add refund and chargeback processing before production sales.

## Phase 7: Voting Cutover

- Install `RealVoteBridge` on the Velocity proxy, where NuVotifier is the only public vote receiver.
- Forward NuVotifier vote events to `/api/vote` with RealCore-style HMAC auth.
- Normalize NuVotifier service names into the current vote contract.
- Configure anti-abuse signals and cooldown enforcement.
- Validate leaderboard and streak behavior in staging.
- Add Discord vote reminders after the core vote path is stable.

## Phase 8: Launch Cutover

- Freeze Tebex purchases.
- Import final active subscription and gift card snapshot.
- Reconcile entitlements against RealCore delivery state.
- Switch store traffic to RealFiction.
- Monitor payment webhooks, reward queue, support tickets, chargebacks, and plugin logs.

## Phase 9: Premium Ecosystem

- Admin update composer with markdown.
- Product admin and coupon tooling.
- Cosmetic preview renderer.
- Profile showcases.
- Tournament hub.
- Discord account sync.
- Redis-ready queue/cache layer when scaling requires it.
