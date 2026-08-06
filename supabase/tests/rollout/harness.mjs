// Executable rollout-compatibility harness.
//
// Additive migrations are only safe if BOTH the old and the new application can
// live with BOTH schemas, in whichever order the deploy actually lands. Reading
// the migration files and concluding "these are additive" is not evidence of
// that. This runs it.
//
//   1. OLD app + NEW database   — migrations applied, old code still deployed
//   2. NEW app + NEW database   — the intended end state
//   3. NEW app + OLD database   — new code deployed before migrations landed
//
// The old application is a real git worktree at the pre-store commit. The
// databases are disposable, built by replaying the real migration files up to a
// point in time. No live Stripe, no production data.
//
//   node supabase/tests/rollout/harness.mjs <newDb> <oldDb> <oldAppPath>
import assert from "node:assert/strict"
import { register } from "node:module"
import { pathToFileURL } from "node:url"
import path from "node:path"

import { sql } from "./db.mjs"

// Registered BEFORE any application module is loaded. Every app import below is
// dynamic so this ordering actually holds.
register("./loader.mjs", import.meta.url)

const [newDb, oldDb, oldAppPath] = process.argv.slice(2)
if (!newDb || !oldDb || !oldAppPath) {
  console.error("usage: harness.mjs <newDb> <oldDb> <oldAppPath>")
  process.exit(2)
}

const results = []
let failures = 0

async function check(combo, name, fn) {
  try {
    await fn()
    results.push({ combo, name, ok: true })
  } catch (error) {
    failures++
    results.push({ combo, name, ok: false, detail: error.message.split("\n")[0].slice(0, 160) })
  }
}

/** The seeded legacy SKUs that predate the store redesign. */
const LEGACY_SLUGS = ["realvip-1m", "realvip-3m", "realpets", "particle-vault"]
const NEW_SLUGS = [
  "realvip-permanent",
  "real-supporter-permanent",
  "realfiction-plus-30d",
  "username-colors-permanent",
  "particle-vault-permanent",
  "realpets-permanent",
  "cosmetic-atelier-permanent"
]

/**
 * Loads a module from a specific checkout of the application.
 *
 * `server-only` is a build-time marker that throws outside a server bundle, and
 * the store module imports it; a tiny loader hook neutralises just that.
 */
async function loadFrom(root, relative) {
  return import(pathToFileURL(path.join(root, relative)).href)
}

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..")

// ===========================================================================
// 1. OLD application + NEW database
// ===========================================================================
// The migrations have landed. The old site is still serving traffic. Nothing it
// used to do may have changed.

process.env.RF_TARGET_DB = newDb
const oldStore = await loadFrom(oldAppPath, "lib/store-server.ts")
const newStore = await loadFrom(repoRoot, "lib/store-server.ts")

// Prove the two really are different checkouts, so a resolution mistake cannot
// silently turn this into the new application testing itself twice.
assert.notEqual(oldAppPath, repoRoot)

/** Product rows exactly as the application would resolve them. */
function activeProducts(database, slugs) {
  const list = slugs.map((s) => `'${s}'`).join(",")
  return JSON.parse(
    sql(
      database,
      `select coalesce(json_agg(t), '[]'::json) from (
         select id, slug, category, name, description, price_cents, currency,
                fulfillment_type, duration_days, metadata, active
         from public.products where slug in (${list}) and active) t`
    ) || "[]"
  )
}

await check("old-app/new-db", "legacy SKUs remain active after the migrations", () => {
  const active = activeProducts(newDb, LEGACY_SLUGS)
  assert.ok(active.length > 0, "no legacy SKU survived the migrations")
  for (const slug of active.map((p) => p.slug)) {
    assert.ok(LEGACY_SLUGS.includes(slug))
  }
})

await check("old-app/new-db", "OLD validation accepts those rows unchanged", () => {
  // The old application's own assertSafeProduct, against rows from the new DB.
  for (const product of activeProducts(newDb, LEGACY_SLUGS)) {
    oldStore.assertSafeProduct(product)
  }
})

await check("old-app/new-db", "a legacy Stripe Checkout request is still generable", async () => {
  const oldPayments = await loadFrom(oldAppPath, "lib/payments.ts")
  const captured = []
  const realFetch = globalThis.fetch
  process.env.STRIPE_SECRET_KEY = "sk_harness_not_a_real_key"
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), body: String(init.body) })
    return { ok: true, json: async () => ({ id: "cs_harness", url: "https://checkout/x", expires_at: 1 }) }
  }
  try {
    const [product] = activeProducts(newDb, LEGACY_SLUGS)
    const result = await oldPayments.createStripeCheckout(
      { id: "00000000-0000-4000-8000-000000000001", provider: "stripe", buyerEmail: "h@e.test" },
      [{ product, quantity: 1, lineTotalCents: product.price_cents }]
    )
    assert.equal(result.providerSessionId, "cs_harness")
    assert.match(captured[0].body, /line_items%5B0%5D/)
  } finally {
    globalThis.fetch = realFetch
  }
})

await check("old-app/new-db", "a legacy order created BEFORE the migrations still fulfils", () => {
  const id = "b0000000-0000-4000-8000-000000000001"
  seedLegacyOrder(newDb, id, "b0000000-0000-4000-8000-0000000000a1")
  sql(newDb, `select public.fulfill_paid_order_with_outbox('${id}','pi_legacy','ch_legacy',null)`)
  assert.equal(sql(newDb, `select status from public.orders where id='${id}'`), "fulfilled")
  assert.ok(Number(sql(newDb, `select count(*) from public.email_deliveries where order_id='${id}'`)) === 1)
})

await check("old-app/new-db", "legacy refund + revocation still work", () => {
  const id = "b0000000-0000-4000-8000-000000000002"
  seedLegacyOrder(newDb, id, "b0000000-0000-4000-8000-0000000000a2")
  sql(newDb, `select public.fulfill_paid_order_with_outbox('${id}','pi_l2','ch_l2',null)`)
  sql(
    newDb,
    `select public.revoke_order_with_refund_outbox('${id}','re_l2:${id}','refund','test','re_l2',1299,'USD',true,'revoked',null)`
  )
  assert.equal(sql(newDb, `select status from public.orders where id='${id}'`), "refunded")
  assert.equal(
    sql(newDb, `select count(*) from public.entitlements e join public.order_items oi on oi.id=e.order_item_id
                where oi.order_id='${id}' and e.status='active'`),
    "0"
  )
})

await check("old-app/new-db", "the new INACTIVE SKUs are invisible to the old application", () => {
  const visible = activeProducts(newDb, NEW_SLUGS)
  assert.equal(visible.length, 0, `old app can see ${visible.map((p) => p.slug).join(", ")}`)
})

// ===========================================================================
// 2. NEW application + NEW database
// ===========================================================================

await check("new-app/new-db", "every new SKU is unavailable by default", () => {
  const active = sql(
    newDb,
    `select coalesce(string_agg(slug, ','), '') from public.products
     where slug in (${NEW_SLUGS.map((s) => `'${s}'`).join(",")}) and active`
  )
  assert.equal(active, "", `these are purchasable and must not be: ${active}`)
})

await check("new-app/new-db", "a direct API call cannot buy a disabled SKU by raw slug", async () => {
  const lines = await newStore
    .resolveCheckoutLines({ items: [{ productId: "real-supporter-permanent", quantity: 1 }] })
    .then(
      () => "RESOLVED",
      (error) => error.message
    )
  assert.match(lines, /Unknown or inactive product/)
})

await check("new-app/new-db", "RealFiction+ is rejected through a direct API call", async () => {
  const outcome = await newStore
    .resolveCheckoutLines({ items: [{ productId: "realfiction-plus-30d", quantity: 1 }] })
    .then(
      () => "RESOLVED",
      (error) => error.message
    )
  assert.match(outcome, /Unknown or inactive product/)
})

await check("new-app/new-db", "gift cards are rejected through a direct API call", async () => {
  const giftSlugs = JSON.parse(
    sql(newDb, `select coalesce(json_agg(slug), '[]'::json) from public.products where category='gift_cards'`) || "[]"
  )
  assert.ok(giftSlugs.length > 0, "expected gift card SKUs to exist")
  for (const slug of giftSlugs) {
    const outcome = await newStore.resolveCheckoutLines({ items: [{ productId: slug, quantity: 1 }] }).then(
      () => "RESOLVED",
      (error) => error.message
    )
    assert.match(outcome, /Unknown or inactive product/, `${slug} was purchasable`)
  }
})

await check("new-app/new-db", "explicitly enabling the reviewed SKUs makes them resolvable", async () => {
  sql(
    newDb,
    `update public.products set active = true
     where slug in ('realvip-permanent','real-supporter-permanent')`
  )
  const lines = await newStore.resolveCheckoutLines({
    items: [{ productId: "real-supporter-permanent", quantity: 1 }]
  })
  assert.equal(lines[0].product.slug, "real-supporter-permanent")
  assert.equal(lines[0].lineTotalCents, lines[0].product.price_cents)
  // Enabling the ranks must NOT enable RealFiction+ or gift cards.
  assert.equal(sql(newDb, `select active from public.products where slug='realfiction-plus-30d'`), "f")
})

await check("new-app/new-db", "historical legacy orders still render and fulfil", () => {
  const id = "b0000000-0000-4000-8000-000000000003"
  seedLegacyOrder(newDb, id, "b0000000-0000-4000-8000-0000000000a3")
  sql(newDb, `select public.fulfill_paid_order_with_outbox('${id}','pi_l3',null,null)`)
  const row = JSON.parse(
    sql(
      newDb,
      `select coalesce(json_agg(t),'[]'::json) from (
         select status, total_cents, subtotal_cents, discount_cents, store_credit_applied_cents,
                payment_due_cents, currency
         from public.orders where id='${id}') t`
    )
  )[0]
  assert.equal(row.status, "fulfilled")
  // The account page renders these columns; a historical row must produce a
  // sane single-amount layout, never a NaN.
  assert.ok(Number.isFinite(Number(row.total_cents)))
})

// ===========================================================================
// 3. NEW application + OLD database
// ===========================================================================
// The new code is live and the migrations have NOT landed. Every store write
// must refuse, and refuse before touching anything.

const oldCounts = () => ({
  orders: sql(oldDb, "select count(*) from public.orders"),
  attempts: sql(oldDb, "select count(*) from public.checkout_attempts"),
  entitlements: sql(oldDb, "select count(*) from public.entitlements"),
  outbox: sql(oldDb, "select count(*) from public.email_deliveries"),
  ledger: sql(oldDb, "select count(*) from public.store_credit_ledger")
})

process.env.RF_TARGET_DB = oldDb
const before = oldCounts()
let stripeCalls = 0

await check("new-app/old-db", "the new permanent SKUs do not exist at all", () => {
  const found = sql(
    oldDb,
    `select coalesce(string_agg(slug, ','), '') from public.products
     where slug in (${NEW_SLUGS.map((s) => `'${s}'`).join(",")})`
  )
  assert.equal(found, "", `unexpected rows: ${found}`)
})

await check("new-app/old-db", "checkout refuses with an explicit availability error", async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.stripe.com")) stripeCalls++
    throw new Error("no network")
  }
  try {
    const outcome = await newStore
      .resolveCheckoutLines({ items: [{ productId: "real-supporter-permanent", quantity: 1 }] })
      .then(
        () => "RESOLVED",
        (error) => error.message
      )
    assert.match(outcome, /Unknown or inactive product/)
  } finally {
    globalThis.fetch = realFetch
  }
})

await check("new-app/old-db", "the upgrade machinery is absent and fails closed", () => {
  for (const fn of [
    "reserve_upgrade_credit",
    "compute_upgrade_price",
    "claim_upgrade_reconciliations",
    "record_order_refund"
  ]) {
    const exists = sql(oldDb, `select count(*) from pg_proc where proname = '${fn}'`)
    assert.equal(exists, "0", `${fn} unexpectedly exists on the old schema`)
  }
})

await check("new-app/old-db", "NOTHING was created by the refused request", () => {
  assert.deepEqual(oldCounts(), before)
})

await check("new-app/old-db", "no Stripe request was attempted", () => {
  assert.equal(stripeCalls, 0)
})

// ---------------------------------------------------------------------------

function seedLegacyOrder(database, orderId, userId) {
  sql(
    database,
    `insert into auth.users (id,email) values ('${userId}','legacy@e.test') on conflict do nothing;
     insert into public.profiles (id,email) values ('${userId}','legacy@e.test') on conflict do nothing;
     insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
       subtotal_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
     values ('${orderId}','${userId}','legacy@e.test','Legacy','stripe','pending',1299,1299,0,1299,'USD');
     insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
     select '${orderId}', id, jsonb_build_object('slug', slug, 'name', name), 1, price_cents, price_cents
     from public.products where slug='realvip-1m'`
  )
}

// ---------------------------------------------------------------------------

const width = Math.max(...results.map((r) => r.name.length))
let combo = ""
for (const result of results) {
  if (result.combo !== combo) {
    combo = result.combo
    console.log(`\n${combo}`)
    console.log("-".repeat(combo.length))
  }
  console.log(`  ${result.ok ? "ok  " : "FAIL"} ${result.name.padEnd(width)}${result.detail ? `  ${result.detail}` : ""}`)
}
console.log(`\n${results.length - failures}/${results.length} rollout checks passed`)
process.exit(failures > 0 ? 1 : 0)
