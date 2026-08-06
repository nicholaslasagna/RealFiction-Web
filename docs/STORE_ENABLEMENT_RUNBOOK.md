# Store enablement runbook — permanent ranks

**Status: not executed. Prices are proposals awaiting Nicholas's approval.**

Applying the store migrations deliberately does **not** put anything on sale.
Every new SKU ships `active = false`, and `resolveCheckoutLines` only resolves
active products — so the old site, the new site, a direct `POST
/api/store/checkout`, and a raw service-role call all refuse them until an
operator runs this.

The script is [`docs/sql/store-permanent-rank-enablement.sql`](sql/store-permanent-rank-enablement.sql).

## Why this exists instead of a one-line UPDATE

The previous instruction was a bare `update public.products set active = true
where slug in (...)` in a migration comment. Three things are wrong with that:

- it enables whatever the pasted slug list happens to contain, including a
  typo'd or stale entry;
- it does not check that the prices in the database are the prices that were
  approved; and
- it has no failure mode. A partial paste enables a subset and leaves the store
  in a state nobody chose.

The script below refuses to run at all unless every precondition holds, and
leaves the transaction open so a human reads the result before committing.

## Prices under review

| SKU | Proposed | Notes |
|---|---|---|
| `realvip-permanent` | **$12.99** (1299) | Permanent, non-expiring |
| `real-supporter-permanent` | **$34.99** (3499) | Permanent; **includes** RealVIP |
| upgrade RealVIP → RealSupporter | **$22.00** (2200) | Derived: 3499 − 1299. Never stored; computed server-side |

If the approved numbers differ, edit the expected values in the script **first**.
Do not reprice by hand and then run it — the price checks exist precisely to
catch a database that disagrees with what was approved.

## Preconditions the script enforces

It aborts the entire transaction on any of these:

1. Store migrations not fully applied (through `202607280001`).
2. `claim_upgrade_reconciliations` missing — the reconciliation half is not deployed.
3. Either SKU missing.
4. `realvip-permanent` ≠ 1299, or `real-supporter-permanent` ≠ 3499.
5. Either rank is not `fulfillment_type = 'permanent'` with `duration_days IS NULL`.
6. `real-supporter-permanent` does not include `realvip-permanent`.
7. The `realvip-permanent → real-supporter-permanent` upgrade path is missing.
8. `realfiction-plus-30d` is active. **It must not be** — RealCore does not
   enforce its benefits yet, so selling it would be selling something that does
   not exist in game.
9. Any `gift_cards` SKU is active. The storefront presents gift cards as coming
   soon; the API must agree.

It then enables **only** the two explicitly enumerated slugs. No category match,
no `LIKE`, nothing that could pick up a SKU added later.

## Running it

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/sql/store-permanent-rank-enablement.sql
```

The script ends in `ROLLBACK`. That is intentional: the default outcome of
running it is that nothing changes and you see what *would* change.

To actually enable:

1. Run it as above and read the two result tables.
2. Confirm `realvip-permanent` and `real-supporter-permanent` show `active = t`
   at 1299 and 3499, every other listed SKU shows `active = f`, and gift cards
   show `active_count = 0`.
3. Change the final `rollback;` to `commit;` and run it once more.

## Rollback

Enablement is one boolean. To take the ranks back off sale:

```sql
begin;
update public.products
set active = false, updated_at = now()
where slug in ('realvip-permanent', 'real-supporter-permanent');

select slug, active from public.products
where slug in ('realvip-permanent', 'real-supporter-permanent');
commit;
```

This does not touch orders, entitlements, upgrade reservations, or store credit.
Customers who already bought keep everything; the SKUs simply stop being
purchasable. Pending checkouts already holding a Stripe session are unaffected —
they resolve through the normal webhook or reconciliation path.

## Post-enable verification

```sql
-- 1. Exactly two new SKUs are purchasable, at the approved prices.
select slug, price_cents, active from public.products
where fulfillment_type = 'permanent' and active order by slug;

-- 2. Nothing unintended came along.
select slug, active from public.products
where slug = 'realfiction-plus-30d' or category = 'gift_cards';

-- 3. The upgrade quote produces the approved number for a real VIP owner.
--    Replace the uuid with a test account that owns a paid permanent RealVIP.
select eligible, reason, target_price_cents, credit_cents, upgrade_price_cents
from public.compute_upgrade_price('00000000-0000-0000-0000-000000000000', 'real-supporter-permanent');
-- Expect: eligible = t, target 3499, credit 1299, upgrade_price 2200.

-- 4. No upgrade reservation is stuck.
select state, count(*) from public.upgrade_credit_reservations group by state;
-- 'needs_review' rows are a human queue, not an error, but should be zero here.

-- 5. Reconciliation has nothing outstanding.
select count(*) from public.claim_upgrade_reconciliations('runbook-probe', 1, 30);
-- Expect 0. Note this CLAIMS a row for 30s if one is due; harmless, but do not
-- run it repeatedly while investigating an incident.
```

## Later, separately: the contract step

Legacy timed SKUs (`realvip-1m`, `realvip-3m`, …) stay **active** through this
step. That is deliberate: during the deploy overlap the previously deployed site
is still serving traffic and still resolves them. Deactivating them in a
migration is what caused the earlier deploy-order problem.

Retire them only once the new application is fully deployed everywhere and no
old instance remains:

```sql
begin;
update public.products set active = false, updated_at = now()
where fulfillment_type = 'subscription'
  and slug like 'realvip-%m';
select slug, active from public.products where slug like 'realvip-%m';
commit;
```

Existing timed entitlements are untouched and run to their expiry. Only new
purchases stop.

## What this runbook does not do

- It does not create, reprice, or delete any SKU.
- It does not enable RealFiction+ or gift cards, and aborts if either is already
  enabled.
- It does not migrate, expire, or convert existing legacy entitlements.
- It does not configure Stripe, Cloudflare, or Resend.
