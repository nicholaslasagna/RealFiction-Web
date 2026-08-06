-- RealFiction store: permanent rank enablement
-- ============================================================================
-- DO NOT RUN THIS UNTIL NICHOLAS HAS APPROVED THE PRICES.
--
-- This turns proposed prices into live prices. It is the only supported way to
-- make the permanent ranks purchasable; applying migrations deliberately does
-- not, because a migration should never put a price on sale as a side effect of
-- a deploy.
--
-- Run it as a single transaction against ONE database at a time, read the
-- output, and only then COMMIT. Every precondition below aborts the whole thing
-- if it does not hold, so a half-enabled store is not a state this can reach.
--
-- Prices below are PROPOSALS awaiting approval:
--     RealVIP permanent          1299   ($12.99)
--     RealSupporter permanent    3499   ($34.99)
--     implied upgrade price      2200   ($22.00)
-- If the approved numbers differ, change EXPECTED_PRICES here first — do not
-- edit the products table by hand and then run this.
-- ============================================================================

begin;

-- Nobody else may reprice or toggle these rows while the checks below run.
lock table public.products in share row exclusive mode;

do $$
declare
  v_missing text;
  v_actual bigint;
begin
  -- 1. The schema is the one these SKUs were designed against ---------------
  if to_regclass('public.product_inclusions') is null
     or to_regclass('public.product_upgrades') is null
     or to_regclass('public.upgrade_credit_reservations') is null
     or to_regclass('public.order_refunds') is null then
    raise exception 'ABORT: store migrations are not fully applied (expected through 202607280001)';
  end if;

  if not exists (select 1 from pg_proc where proname = 'claim_upgrade_reconciliations') then
    raise exception 'ABORT: reconciliation claim function is missing; 202607280001 has not been applied';
  end if;

  -- 2. Every SKU we intend to enable exists ---------------------------------
  select string_agg(slug, ', ') into v_missing
  from (values ('realvip-permanent'), ('real-supporter-permanent')) as intended(slug)
  where not exists (select 1 from public.products p where p.slug = intended.slug);

  if v_missing is not null then
    raise exception 'ABORT: missing SKU(s): %', v_missing;
  end if;

  -- 3. Prices are EXACTLY the approved numbers ------------------------------
  select price_cents into v_actual from public.products where slug = 'realvip-permanent';
  if v_actual is distinct from 1299 then
    raise exception 'ABORT: realvip-permanent is % cents, expected 1299', v_actual;
  end if;

  select price_cents into v_actual from public.products where slug = 'real-supporter-permanent';
  if v_actual is distinct from 3499 then
    raise exception 'ABORT: real-supporter-permanent is % cents, expected 3499', v_actual;
  end if;

  -- 4. Fulfillment types are permanent, not timed ---------------------------
  if exists (
    select 1 from public.products
    where slug in ('realvip-permanent', 'real-supporter-permanent')
      and (fulfillment_type <> 'permanent' or duration_days is not null)
  ) then
    raise exception 'ABORT: a rank being enabled is not a non-expiring permanent product';
  end if;

  -- 5. RealSupporter INCLUDES RealVIP ---------------------------------------
  -- Without this the premium rank silently stops granting what it advertises.
  if not exists (
    select 1 from public.product_inclusions
    where parent_slug = 'real-supporter-permanent'
      and child_slug = 'realvip-permanent'
  ) then
    raise exception 'ABORT: real-supporter-permanent does not include realvip-permanent';
  end if;

  -- 6. The upgrade path exists and is priced from the source ----------------
  if not exists (
    select 1 from public.product_upgrades
    where from_slug = 'realvip-permanent' and to_slug = 'real-supporter-permanent'
  ) then
    raise exception 'ABORT: the RealVIP -> RealSupporter upgrade path is missing';
  end if;

  -- 7. RealFiction+ stays unavailable ---------------------------------------
  -- RealCore does not enforce its benefits yet. Selling it would be selling
  -- something that does not exist in game.
  if exists (select 1 from public.products where slug = 'realfiction-plus-30d' and active) then
    raise exception 'ABORT: realfiction-plus-30d is active and must not be';
  end if;

  -- 8. Gift cards stay unavailable ------------------------------------------
  -- The storefront presents them as coming soon; the API must agree.
  if exists (select 1 from public.products where category = 'gift_cards' and active) then
    raise exception 'ABORT: gift card SKUs are active and must not be';
  end if;

  -- 9. Legacy timed SKUs are in the intended rollout state -------------------
  -- During the overlap window they stay ACTIVE so the previously deployed site
  -- keeps working (expand-and-contract). Retiring them is a SEPARATE, later
  -- step — see the "contract" section of the runbook — and must not happen as a
  -- side effect of enabling the permanent ranks.
  if not exists (select 1 from public.products where slug = 'realvip-1m' and active) then
    raise notice 'NOTE: legacy timed SKUs are already retired. That is expected only AFTER the contract step.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Enable ONLY the two reviewed permanent ranks
-- ---------------------------------------------------------------------------
-- Enumerated explicitly. No category match, no LIKE pattern, nothing that could
-- pick up a SKU added later.
update public.products
set active = true, updated_at = now()
where slug in ('realvip-permanent', 'real-supporter-permanent')
  and not active;

-- ---------------------------------------------------------------------------
-- Read this before committing
-- ---------------------------------------------------------------------------
select slug, name, price_cents, currency, fulfillment_type, duration_days, active
from public.products
where slug in (
  'realvip-permanent', 'real-supporter-permanent', 'realfiction-plus-30d',
  'username-colors-permanent', 'particle-vault-permanent',
  'realpets-permanent', 'cosmetic-atelier-permanent'
)
order by active desc, slug;

select category, count(*) filter (where active) as active_count, count(*) as total
from public.products
where category = 'gift_cards'
group by category;

-- Expected:
--   realvip-permanent          1299  permanent  active = true
--   real-supporter-permanent   3499  permanent  active = true
--   every other row                             active = false
--   gift_cards                                  active_count = 0
--
-- If any line disagrees:  ROLLBACK;
-- If every line agrees:   COMMIT;

rollback;  -- <- change to COMMIT only after reading the output above
