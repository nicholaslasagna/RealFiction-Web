// The catalog contract.
//
// Seven products, four durations each, twenty-eight purchasable SKUs, at exactly
// the approved prices. These assertions exist because the last time this file
// was wrong the store invented products that did not exist in Stripe — so the
// numbers are written out literally rather than derived from the thing under
// test.
import assert from "node:assert/strict"
import { register } from "node:module"
import test from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

import {
  BILLING_DISCLOSURE,
  bestValueSlug,
  CATALOG,
  DURATION_LABEL,
  effectiveMonthlyCents,
  findPrice,
  purchasableProducts,
  purchasableSlugs,
  savingsPercent
} from "./store/catalog.ts"

const { isPurchasableSlug, rejectUnsellableProducts, PURCHASABLE_SKU_COUNT } = await import(
  "./checkout-guard.ts"
)

/** The approved catalog, written out. slug -> [months, cents, lookup key]. */
const APPROVED: Record<string, [number, number, string]> = {
  "realvip-1m": [1, 499, "realvip_1m"],
  "realvip-3m": [3, 1299, "realvip_3m"],
  "realvip-6m": [6, 2399, "realvip_6m"],
  "realvip-12m": [12, 3999, "realvip_12m"],
  "real-supporter-1m": [1, 999, "realsupporter_1m"],
  "real-supporter-3m": [3, 2699, "realsupporter_3m"],
  "real-supporter-6m": [6, 4799, "realsupporter_6m"],
  "real-supporter-12m": [12, 7999, "realsupporter_12m"],
  "cosmetic-atelier-1m": [1, 699, "cosmetic_atelier_1m"],
  "cosmetic-atelier-3m": [3, 1899, "cosmetic_atelier_3m"],
  "cosmetic-atelier-6m": [6, 3399, "cosmetic_atelier_6m"],
  "cosmetic-atelier-12m": [12, 5599, "cosmetic_atelier_12m"],
  "realpets-1m": [1, 299, "realpets_1m"],
  "realpets-3m": [3, 799, "realpets_3m"],
  "realpets-6m": [6, 1399, "realpets_6m"],
  "realpets-12m": [12, 2399, "realpets_12m"],
  "particle-vault-1m": [1, 349, "particle_vault_1m"],
  "particle-vault-3m": [3, 899, "particle_vault_3m"],
  "particle-vault-6m": [6, 1699, "particle_vault_6m"],
  "particle-vault-12m": [12, 2799, "particle_vault_12m"],
  "username-colors-1m": [1, 199, "username_colors_1m"],
  "username-colors-3m": [3, 499, "username_colors_3m"],
  "username-colors-6m": [6, 899, "username_colors_6m"],
  "username-colors-12m": [12, 1599, "username_colors_12m"],
  "lobby-flight-1m": [1, 249, "lobby_flight_1m"],
  "lobby-flight-3m": [3, 649, "lobby_flight_3m"],
  "lobby-flight-6m": [6, 1199, "lobby_flight_6m"],
  "lobby-flight-12m": [12, 1999, "lobby_flight_12m"]
}

const APPROVED_ENTITLEMENTS: Record<string, string> = {
  realvip: "rank.realvip",
  realsupporter: "rank.realsupporter",
  cosmetic_atelier: "cosmetic.atelier",
  realpets: "cosmetic.pets",
  particle_vault: "cosmetic.particles",
  username_colors: "cosmetic.username_colors",
  lobby_flight: "capability.lobby_flight"
}

// -- Shape --------------------------------------------------------------------

test("exactly SEVEN purchasable products", () => {
  assert.equal(purchasableProducts().length, 7)
})

test("exactly TWENTY-EIGHT purchasable SKUs", () => {
  assert.equal(purchasableSlugs().length, 28)
  assert.equal(PURCHASABLE_SKU_COUNT, 28)
})

test("every SKU is exactly the approved slug, duration, price and lookup key", () => {
  const seen = new Set<string>()
  for (const product of purchasableProducts()) {
    for (const price of product.prices) {
      const approved = APPROVED[price.slug]
      assert.ok(approved, `${price.slug} is not an approved SKU`)
      const [months, cents, lookupKey] = approved
      assert.equal(price.months, months, `${price.slug} duration`)
      assert.equal(price.priceCents, cents, `${price.slug} price`)
      assert.equal(price.stripeLookupKey, lookupKey, `${price.slug} lookup key`)
      seen.add(price.slug)
    }
  }
  assert.equal(seen.size, Object.keys(APPROVED).length, "a SKU is missing from the catalog")
})

test("every product offers exactly 1, 3, 6 and 12 months", () => {
  for (const product of purchasableProducts()) {
    assert.deepEqual(
      product.prices.map((price) => price.months).sort((a, b) => a - b),
      [1, 3, 6, 12],
      product.id
    )
  }
})

test("entitlement keys match the approved Stripe metadata", () => {
  for (const product of purchasableProducts()) {
    assert.equal(product.stripeEntitlement, APPROVED_ENTITLEMENTS[product.id], product.id)
  }
})

test("the server allowlist and the catalog agree exactly", () => {
  const allowed = Object.keys(APPROVED).filter(isPurchasableSlug).sort()
  assert.deepEqual(allowed, purchasableSlugs().sort())
  assert.equal(allowed.length, 28)
})

// -- What must NOT exist ------------------------------------------------------

test("NO permanent SKU exists anywhere in the catalog", () => {
  const serialized = JSON.stringify(CATALOG)
  assert.ok(!/-permanent/.test(serialized), "a permanent SKU survived")
  assert.ok(!/permanent unlock/i.test(serialized), "permanent-unlock copy survived")
  assert.ok(!/never expire/i.test(serialized), "never-expires copy survived")
  assert.ok(!/lifetime/i.test(serialized), "lifetime copy survived")
})

test("RealFiction+ does not exist", () => {
  assert.ok(!/realfiction[-_ ]?\+|realfiction-plus/i.test(JSON.stringify(CATALOG)))
  for (const slug of ["realfiction-plus-30d", "realfiction-plus"]) {
    assert.equal(isPurchasableSlug(slug), false)
  }
})

test("nothing claims one product includes another", () => {
  const serialized = JSON.stringify(CATALOG)
  assert.ok(!/includes realvip/i.test(serialized))
  assert.ok(!/everything in realvip/i.test(serialized))
  assert.ok(!/upgrade/i.test(serialized), "upgrade wording survived in the catalog")
})

test("no invented perk counts appear in any description", () => {
  // "8 username colors", "3 permanent pets", "4 particle effects" and the rest
  // were invented. Descriptions are the approved text and nothing more.
  for (const product of CATALOG) {
    assert.ok(
      !/\b\d+\s+(username colou?rs|cosmetic (loadout )?slots|permanent pets|permanent particle)/i.test(
        product.description
      ),
      `${product.id} description contains an invented quantity`
    )
  }
})

test("copy uses US spelling", () => {
  const serialized = JSON.stringify(CATALOG)
  for (const britishism of [/colour/i, /customise/i, /organis/i, /catalogue/i]) {
    assert.ok(!britishism.test(serialized), `catalog copy contains ${britishism}`)
  }
})

test("every product carries the exact approved description", () => {
  const realvip = CATALOG.find((product) => product.id === "realvip")
  assert.equal(
    realvip?.description,
    "Cosmetic supporter access for the RealFiction Minecraft network, including supporter profile style, chat flair, and lobby cosmetic perks. No gameplay or competitive advantages."
  )
  const flight = CATALOG.find((product) => product.id === "lobby_flight")
  assert.match(flight?.description ?? "", /does not apply to survival, Factions, PvP, BedWars/)
})

// -- Gift cards ---------------------------------------------------------------

test("gift cards are present as coming-soon and have NO purchasable price", () => {
  const gift = CATALOG.find((product) => product.id === "gift_card")
  assert.ok(gift)
  assert.equal(gift?.availability, "coming-soon")
  assert.deepEqual(gift?.prices, [])
})

test("every gift-card denomination is refused by the server", () => {
  for (const amount of [5, 10, 15, 20, 25, 30, 50, 75, 100]) {
    assert.equal(isPurchasableSlug(`gift-card-${amount}`), false, `gift-card-${amount}`)
    assert.ok(rejectUnsellableProducts([{ slug: `gift-card-${amount}` }]))
  }
})

// -- Disclosure ---------------------------------------------------------------

test("the billing disclosure says one-time payment and no auto-renewal", () => {
  assert.deepEqual([...BILLING_DISCLOSURE], ["One-time payment", "Does not automatically renew"])
})

test("no duration is described as a subscription or a renewal", () => {
  for (const label of Object.values(DURATION_LABEL)) {
    assert.ok(!/per month|\/mo\b|monthly|subscription/i.test(label), label)
  }
})

// -- Derived presentation -----------------------------------------------------

test("effective monthly price is derived from the authoritative price", () => {
  const realvip = CATALOG.find((product) => product.id === "realvip")!
  const twelve = realvip.prices.find((price) => price.months === 12)!
  // 3999 / 12 = 333.25 -> 333
  assert.equal(effectiveMonthlyCents(twelve), 333)
})

test("savings compare against buying the same months one at a time", () => {
  const realvip = CATALOG.find((product) => product.id === "realvip")!
  const three = realvip.prices.find((price) => price.months === 3)!
  const twelve = realvip.prices.find((price) => price.months === 12)!
  // 3 x 499 = 1497 vs 1299 -> 13%
  assert.equal(savingsPercent(realvip, three), 13)
  // 12 x 499 = 5988 vs 3999 -> 33%
  assert.equal(savingsPercent(realvip, twelve), 33)
  // A one-month purchase is the baseline and claims nothing.
  assert.equal(savingsPercent(realvip, realvip.prices.find((price) => price.months === 1)!), 0)
})

test("every product's savings claim is true, for every duration", () => {
  for (const product of purchasableProducts()) {
    const monthly = product.prices.find((price) => price.months === 1)!
    for (const price of product.prices) {
      const claimed = savingsPercent(product, price)
      if (claimed > 0) {
        const baseline = monthly.priceCents * price.months
        assert.ok(price.priceCents < baseline, `${price.slug} claims savings but is not cheaper`)
      }
    }
  }
})

test("Best value is the lowest MONTHLY rate, and it is the 12-month option", () => {
  for (const product of purchasableProducts()) {
    const best = bestValueSlug(product)
    const cheapest = product.prices.reduce((a, b) =>
      effectiveMonthlyCents(a) <= effectiveMonthlyCents(b) ? a : b
    )
    assert.equal(best, cheapest.slug, product.id)
    assert.equal(cheapest.months, 12, `${product.id} 12 months should be the best monthly rate`)
  }
})

test("nothing is labelled most popular — there are no analytics for that", () => {
  assert.ok(!/most popular/i.test(JSON.stringify(CATALOG)))
})

// -- Lookups ------------------------------------------------------------------

test("findPrice resolves a duration slug to its product and duration", () => {
  const found = findPrice("realpets-6m")
  assert.equal(found?.product.id, "realpets")
  assert.equal(found?.price.months, 6)
  assert.equal(found?.price.priceCents, 1399)
  assert.equal(findPrice("realvip-permanent"), null)
  assert.equal(findPrice("nope"), null)
})
