# Staging Supabase Verification Checklist

Use this checklist before any production cutover. Run it against a staging Supabase project first, then repeat in production only after the staging run is clean.

## Migration Order

Apply migrations in filename order:

1. `supabase/migrations/202605200001_realfiction_platform.sql`
2. `supabase/migrations/202605200002_security_hardening.sql`
3. `supabase/migrations/202605200003_realcore_delivery.sql`
4. `supabase/migrations/202605200004_plugin_nonce_cleanup.sql`

The order matters:

- `202605200001` creates core enums, tables, triggers, seed vote sites, and baseline RLS policies.
- `202605200002` tightens RLS, splits user-writable profile settings, seeds safe store products, and adds idempotent payment fulfillment.
- `202605200003` adds RealCore reward claim fields, plugin nonce replay storage, and service-role-only poll/ack SQL functions.
- `202605200004` adds the service-role-only `cleanup_plugin_request_nonces()` prune function.

## Local Verification

```bash
supabase start
supabase db reset
npm run test:rls
supabase db lint
```

`supabase db reset` recreates the local database and applies migrations in order. Do not run reset against staging or production.

## Staging Link And Push

```bash
supabase login
supabase link --project-ref <staging-project-ref>
supabase migration list
supabase db push --dry-run
supabase db push
supabase migration list
```

Confirm the dry run includes only the three RealFiction migrations above unless another reviewed migration has been intentionally added.

## Staging Test Run

For database-level RLS tests against local Supabase:

```bash
npm run test:rls
```

For staging, prefer a temporary branch or staging clone when available. If tests must run against a persistent staging database, create a disposable testing project or restore staging from a snapshot after the run because pgTAP test data writes directly to `auth.users` and application tables.

## Smoke Checks After Push

```bash
supabase db lint
supabase migration list
```

Then verify from the deployed site with staging environment variables:

- `/api/store/checkout` creates a pending local order before Stripe/PayPal checkout.
- Stripe and PayPal webhook replays do not duplicate reward rows.
- `/api/vote` rejects missing or invalid `VOTE_WEBHOOK_SECRET`.
- `/api/plugin/rewards/poll` rejects missing auth.
- `/api/plugin/rewards/poll` accepts HMAC auth and marks pending rows `processing`.
- `/api/plugin/rewards/ack` marks processing rows `delivered` or `failed`.
- `/api/plugin/account-link/confirm` verifies only valid pending codes.

## Rollback And Restore Notes

Supabase migrations are forward-only by default. For staging rollback:

1. Prefer restoring the staging project from a Supabase database backup taken before `supabase db push`.
2. If using Supabase branching, delete the failed branch and create a fresh branch from production/staging base.
3. If no backup/branch is available, write an explicit corrective migration instead of editing an already-applied migration.

Before production:

- Export a pre-push backup.
- Keep Tebex fulfillment frozen or in dual-read mode until webhook and RealCore delivery smoke tests pass.
- Do not run `supabase db reset` on staging or production.

## Audit Verification Status (2026-05-20)

Build and type verification on this branch:

- `npm run typecheck` — pass.
- `npm run build` — pass (Next.js 16.2.6; all 13 API routes compile as edge functions).
- `npm run build:cloudflare` — pass (`.open-next/worker.js` generated).
- `npm audit --audit-level=high` — pass (0 high/critical). 7 moderate advisories remain, all confined to build/dev tooling (`postcss` via `next`, `ws` via `wrangler`/`miniflare`); none are in the runtime request path. Do not run `npm audit fix --force` — it downgrades `next` to 9.x.

Database/RLS verification was performed structurally (the four migrations and `supabase/tests/database/rls_security.test.sql` were reviewed line by line) because the local Supabase stack could not bind its default ports: another local Supabase project on this machine (`imagicast-account`) currently holds 54321-54327.

### Run the RLS suite once a DB port is free

Option A — stop the other local project first (only if safe to do so):

```bash
supabase stop --project-id imagicast-account
supabase start
supabase db reset
npm run test:rls
supabase db lint
```

Option B — run RealFiction on non-default ports without touching the other project. Temporarily change `[api].port`, `[db].port`, `[db].shadow_port`, `[studio].port`, `[inbucket].port`, and the analytics port in `supabase/config.toml`, then:

```bash
supabase start
supabase db reset
npm run test:rls
supabase db lint
supabase stop
```

Expected result: `rls_security.test.sql` declares `plan(27)` and all 27 assertions pass.

## Pre-Production Hardening

### Resolved in the hardening pass (2026-05-20)

1. Shared-secret plugin auth is now gated by `REALCORE_ALLOW_SHARED_SECRET` (off by default → HMAC required). Vote-webhook secrets are unaffected.
2. Legacy `POST /api/account/link/verify` route deleted; `POST /api/plugin/account-link/confirm` (HMAC + nonce) is the only link finalizer.
3. The `serverId` is now part of the HMAC signed message, so a server cannot spoof another server's id.
4. `POST /api/rewards/claim` is owner-only again; plugin delivery transitions go exclusively through the atomic `poll_reward_queue` / `ack_reward_delivery` routes.
5. `cleanup_plugin_request_nonces()` added (migration `202605200004`); schedule it per-environment (pg_cron snippet inline in the migration).
6. Webhook duplicate handling re-drives fulfillment for events persisted-but-not-processed (idempotent), instead of silently dropping a retry.

### Still open before real-money production cutover

- `POST /api/contact` validates but does not persist. When implemented it must insert via the service role (the public-insert policy on `support_tickets` was removed in the hardening migration).
- Add Cloudflare-layer rate limiting / abuse signals on `/api/store/checkout`, `/api/vote`, `/api/account/link/start`, and all `/api/plugin/*` routes.
- Refund / chargeback handling: revoke entitlements and enqueue compensating revoke rewards.
- `vote_streaks` increments `monthly_votes` / `total_votes` only; `current_streak` / `longest_streak` are set once and never advanced, and a concurrent first-insert race is silently swallowed. Cosmetic, but finish before the leaderboard launches.
- Run the RLS suite against a live DB (see commands above) — currently structural only.
