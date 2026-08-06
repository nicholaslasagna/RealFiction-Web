// Catalog integrity.
//
// The catalog is presentation metadata; the Supabase `products` table is the
// billing authority. These tests keep the two honest about each other and keep
// the product-policy invariants (hierarchy, no-auto-renew, gift cards off) from
// silently regressing.
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import {
  BILLING_DISCLOSURE,
  CATALOG,
  CATALOG_BY_ID,
  expandIncludes,
  FAIR_PLAY,
  getProduct,
  isIncludedIn,
  purchasableProducts
} from "./store/catalog.ts"

const repoRoot = path.resolve(import.meta.dirname, "..")
const migration = readFileSync(
  path.join(repoRoot, "supabase", "migrations", "202607230001_permanent_ranks_and_upgrades.sql"),
  "utf8"
)

test("product ids are unique and stable", () => {
  const ids = CATALOG.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length, "duplicate product id")
  for (const id of ids) {
    assert.match(id, /^[a-z0-9-]+$/, `${id} is not a clean slug`)
  }
})

test("entitlement keys match fulfill_paid_order's construction", () => {
  // fulfill_paid_order builds 'product:' || slug — a mismatch would silently
  // grant an entitlement nobody checks for.
  for (const product of CATALOG) {
    assert.equal(product.entitlementKey, `product:${product.id}`, product.id)
  }
})

test("no negative prices", () => {
  for (const product of CATALOG) {
    assert.ok(product.priceCents >= 0, `${product.id} has a negative price`)
  }
})

test("every included product exists, and inclusion has no cycles", () => {
  for (const product of CATALOG) {
    for (const child of product.includes) {
      assert.ok(CATALOG_BY_ID.has(child), `${product.id} includes unknown ${child}`)
    }
    // expandIncludes is cycle-guarded; this asserts the DATA has no cycle.
    assert.ok(!expandIncludes(product.id).includes(product.id), `${product.id} includes itself`)
  }
})

test("RealSupporter includes RealVIP — the core hierarchy rule", () => {
  assert.ok(isIncludedIn("realvip-permanent", "real-supporter-permanent"))
  // ...and not the other way round.
  assert.ok(!isIncludedIn("real-supporter-permanent", "realvip-permanent"))
})

test("the bundle includes its three cosmetic packs", () => {
  const included = expandIncludes("cosmetic-atelier-permanent")
  for (const child of ["username-colors-permanent", "particle-vault-permanent", "realpets-permanent"]) {
    assert.ok(included.includes(child), `bundle should include ${child}`)
  }
})

test("upgrade targets reference a real product", () => {
  for (const product of CATALOG) {
    if (product.upgradeFrom) {
      assert.ok(CATALOG_BY_ID.has(product.upgradeFrom), `${product.id} upgrades from unknown product`)
    }
  }
})

// -- The no-auto-renew guarantee ---------------------------------------------

test("NO live product claims recurring billing", () => {
  // There is no Stripe Billing foundation in this repo — no customer,
  // subscription, price ids, invoices, or cancellation flow. Claiming automatic
  // renewal would be a lie to the customer.
  for (const product of purchasableProducts()) {
    assert.notEqual(product.billing, "recurring", `${product.id} claims recurring billing`)
  }
})

test("RealFiction+ is a non-renewing fixed-term pass", () => {
  const plus = getProduct("realfiction-plus-30d")!
  assert.equal(plus.billing, "term")
  assert.equal(plus.durationDays, 30)
  assert.deepEqual(BILLING_DISCLOSURE[plus.billing], [
    "One-time purchase",
    "Does not automatically renew"
  ])
})

test("term products declare what expires; permanent products declare nothing expires", () => {
  for (const product of CATALOG) {
    if (product.billing === "term") {
      assert.ok(product.durationDays && product.durationDays > 0, `${product.id} term needs a duration`)
      assert.ok(product.expires.length > 0, `${product.id} must say what expires`)
      assert.ok(product.retained.length > 0, `${product.id} must say what is retained`)
    }
    if (product.billing === "permanent" && product.availability === "available") {
      assert.equal(product.durationDays, null, `${product.id} is permanent but has a duration`)
      assert.equal(product.expires.length, 0, `${product.id} is permanent but claims something expires`)
    }
  }
})

// -- Gift cards --------------------------------------------------------------

test("gift cards are NOT purchasable", () => {
  const gift = CATALOG.filter((p) => p.category === "gift-cards")
  assert.ok(gift.length > 0, "expected a gift-card placeholder")
  for (const product of gift) {
    assert.equal(product.availability, "coming-soon", "gift cards must not be purchasable")
  }
  assert.equal(
    purchasableProducts().some((p) => p.category === "gift-cards"),
    false
  )
})

// -- Merchandising honesty ---------------------------------------------------

test("at most ONE product carries a recommendation badge", () => {
  const badged = CATALOG.filter((p) => p.badge)
  assert.ok(badged.length <= 1, `${badged.length} products are badged; at most one may be`)
})

test("no vague benefit copy", () => {
  const vague = [/^cosmetic perks$/i, /^premium features$/i, /^monthly drop$/i, /^exclusive benefits$/i]
  for (const product of CATALOG) {
    for (const feature of product.features) {
      for (const pattern of vague) {
        assert.doesNotMatch(feature, pattern, `${product.id}: "${feature}" is too vague`)
      }
    }
  }
})

test("every purchasable product states no competitive advantage", () => {
  for (const product of purchasableProducts()) {
    assert.ok(
      product.features.some((f) => /no competitive advantage/i.test(f)),
      `${product.id} must state it grants no competitive advantage`
    )
  }
})

test("the Fair Play Promise names concrete things, not vibes", () => {
  assert.ok(FAIR_PLAY.never.length >= 5)
  assert.ok(FAIR_PLAY.sell.length >= 4)
  for (const line of [...FAIR_PLAY.never, ...FAIR_PLAY.sell]) {
    assert.ok(line.length > 8, `"${line}" is too vague to be a promise`)
  }
})

// -- Assets ------------------------------------------------------------------

test("declared banners exist on disk", () => {
  for (const product of CATALOG) {
    if (product.banner) {
      assert.ok(
        existsSync(path.join(repoRoot, "public", product.banner)),
        `${product.id} banner missing: public${product.banner}`
      )
    }
  }
})

// -- Catalog vs the billing authority ----------------------------------------

test("every purchasable product is seeded in the migration at the SAME price", () => {
  // A price mismatch here is a display bug (checkout uses the DB), but a
  // visible wrong price is still a trust problem.
  for (const product of purchasableProducts()) {
    const seeded = new RegExp(
      `'${product.id}',[\\s\\S]{0,400}?\\n\\s*${product.priceCents}, 'USD'`,
      "m"
    )
    assert.match(migration, seeded, `${product.id} @ ${product.priceCents} not seeded at that price`)
  }
})

test("the migration enforces inclusion server-side, not just in the catalog", () => {
  for (const product of CATALOG) {
    for (const child of product.includes) {
      assert.match(
        migration,
        new RegExp(`'${product.id}',\\s*'${child}'`),
        `inclusion ${product.id} -> ${child} is not enforced server-side`
      )
    }
  }
})

test("the migration never deletes products or entitlements", () => {
  // Legacy compatibility: historical orders must keep joining, and nobody may
  // lose paid value.
  assert.doesNotMatch(migration, /delete\s+from\s+public\.(products|entitlements|orders)/i)
  assert.doesNotMatch(migration, /drop\s+table\s+public\.(products|entitlements|orders)/i)
})
