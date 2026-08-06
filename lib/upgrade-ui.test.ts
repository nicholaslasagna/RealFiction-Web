// What the storefront is allowed to offer, and what it must refuse to imply.
//
// The DOM tests prove the page renders these states; these prove the DECISIONS
// behind them, including the ones that are only visible as an absence — no
// upgrade button, no discounted figure, no quiet substitution of a $34.99
// checkout for the $22.00 one the customer came for.
import assert from "node:assert/strict"
import { register } from "node:module"
import test from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

import {
  ownershipStateFor,
  upgradeErrorMessage,
  UPGRADE_CHECKOUT_ERRORS,
  UPGRADE_COPY,
  upgradeStateFrom,
  type EntitlementView,
  type UpgradeQuoteView
} from "./store/ownership-view.ts"

import { isPurchasableSlug, rejectUnsellableProducts } from "./checkout-guard.ts"
import { CATALOG } from "./store/catalog.ts"

const ELIGIBLE: UpgradeQuoteView = {
  eligible: true,
  reason: "ok",
  targetPriceCents: 3499,
  creditCents: 1299,
  upgradePriceCents: 2200,
  hold: "none"
}

const NO_SOURCE: UpgradeQuoteView = {
  eligible: false,
  reason: "upgrade_credit_unavailable",
  targetPriceCents: 3499,
  creditCents: 0,
  upgradePriceCents: 3499,
  hold: "none"
}

// -- The offer ----------------------------------------------------------------

test("an eligible permanent RealVIP owner is offered the server's exact figures", () => {
  const state = upgradeStateFrom(ELIGIBLE)
  assert.equal(state.kind, "available")
  if (state.kind !== "available") return
  assert.equal(state.targetPriceCents, 3499)
  assert.equal(state.creditCents, 1299)
  assert.equal(state.upgradePriceCents, 2200)
  // The customer can check the arithmetic; nothing is computed here.
  assert.equal(state.targetPriceCents - state.creditCents, state.upgradePriceCents)
})

test("NOTHING is derived in the browser — a changed server quote changes the offer", () => {
  const moved = upgradeStateFrom({ ...ELIGIBLE, creditCents: 999, upgradePriceCents: 2500 })
  assert.equal(moved.kind, "available")
  if (moved.kind !== "available") return
  assert.equal(moved.upgradePriceCents, 2500, "the client must not recompute 3499 - 999")
})

// -- Every ineligible state ---------------------------------------------------

const INELIGIBLE: Array<[string, UpgradeQuoteView | null, string]> = [
  ["no paid source", NO_SOURCE, "no_paid_source"],
  ["credit reserved elsewhere", { ...NO_SOURCE, hold: "reserved" }, "reserved"],
  ["source under review", { ...NO_SOURCE, hold: "needs_review" }, "needs_review"],
  ["target already owned", { ...NO_SOURCE, reason: "upgrade_target_already_owned" }, "target_owned"],
  ["no upgrade path", { ...NO_SOURCE, reason: "no_upgrade_path" }, "no_paid_source"],
  ["target unavailable", { ...NO_SOURCE, reason: "upgrade_target_unavailable" }, "unavailable"],
  ["quote unreadable", null, "none"]
]

for (const [label, quote, expected] of INELIGIBLE) {
  test(`${label} resolves to "${expected}" and never to an offer`, () => {
    const state = upgradeStateFrom(quote)
    assert.equal(state.kind, expected)
    assert.notEqual(state.kind, "available")
  })
}

test("NO ineligible state can produce a price to show", () => {
  for (const [label, quote] of INELIGIBLE) {
    const state = upgradeStateFrom(quote)
    assert.ok(!("upgradePriceCents" in state), `${label} carried a price into an ineligible state`)
  }
})

test("a live hold outranks the quote's generic reason", () => {
  // The customer HAS a paid source; it is simply not free right now. Telling
  // them "we could not find a RealVIP purchase" would be false.
  assert.equal(upgradeStateFrom({ ...NO_SOURCE, hold: "reserved" }).kind, "reserved")
  assert.equal(upgradeStateFrom({ ...NO_SOURCE, hold: "needs_review" }).kind, "needs_review")
})

test("an eligible quote with zero credit is NOT an upgrade", () => {
  // A zero-credit "upgrade" is a full-price purchase wearing an upgrade label.
  assert.notEqual(upgradeStateFrom({ ...ELIGIBLE, creditCents: 0 }).kind, "available")
})

// -- Ownership presentation ---------------------------------------------------

const AUG = "2026-08-30T12:00:00.000Z"

test("a permanent purchase reads as permanent", () => {
  const state = ownershipStateFor(
    "realvip-permanent",
    [{ productId: "realvip-permanent", expiresAt: null, source: "order" }],
    { isPermanentProduct: true }
  )
  assert.deepEqual(state, { kind: "owned_permanent", label: "Owned permanently" })
})

test("a LEGACY dated grant never reads as 'Owned permanently'", () => {
  const state = ownershipStateFor(
    "realvip-permanent",
    [{ productId: "realvip-permanent", expiresAt: AUG, source: "order" }],
    { isPermanentProduct: true }
  )
  assert.equal(state.kind, "legacy_term")
  assert.equal(state.label, "Legacy access active until August 30, 2026")
})

test("a term product's expiry comes from the SERVER, never from the duration", () => {
  const state = ownershipStateFor(
    "realfiction-plus-30d",
    [{ productId: "realfiction-plus-30d", expiresAt: AUG, source: "order" }],
    { isPermanentProduct: false }
  )
  assert.equal(state.kind, "owned_term")
  assert.equal(state.label, "Active until August 30, 2026")
})

test("an INHERITED grant reads as included, not as a purchase", () => {
  const state = ownershipStateFor(
    "realvip-permanent",
    [{ productId: "realvip-permanent", expiresAt: null, source: "inclusion" }],
    { isPermanentProduct: true, includedByOwned: { productId: "real-supporter-permanent", name: "RealSupporter" } }
  )
  assert.equal(state.kind, "included")
  assert.equal(state.label, "Included with RealSupporter")
})

test("an unparseable expiry never renders Invalid Date or implies permanence", () => {
  const state = ownershipStateFor(
    "realvip-permanent",
    [{ productId: "realvip-permanent", expiresAt: "not-a-date", source: "order" }],
    { isPermanentProduct: true }
  )
  assert.equal(state.kind, "owned_term")
  assert.ok(!state.label.includes("Invalid"))
  assert.ok(!state.label.includes("permanently"))
})

test("owning nothing reads as nothing", () => {
  const empty: EntitlementView[] = []
  assert.deepEqual(ownershipStateFor("realvip-permanent", empty, { isPermanentProduct: true }), {
    kind: "none"
  })
})

// -- Customer-facing wording --------------------------------------------------

test("no explanation leaks a reason code, table, or column name", () => {
  const all = [...Object.values(UPGRADE_COPY), ...Object.values(UPGRADE_CHECKOUT_ERRORS)].join(" ")
  for (const leak of [
    /upgrade_credit/,
    /needs_review/,
    /reservation/i,
    /compute_upgrade_price/,
    /entitlement/i,
    /slug/i,
    /_cents/
  ]) {
    assert.ok(!leak.test(all), `customer copy contains ${leak}`)
  }
})

test("every server error code the checkout can return has customer wording", () => {
  // These are the exact `code` values app/api/store/checkout/route.ts emits.
  for (const code of [
    "upgrade_target_already_owned",
    "upgrade_credit_unavailable",
    "upgrade_credit_already_reserved",
    "no_upgrade_path",
    "upgrade_target_unavailable",
    "upgrade_gift_not_supported",
    "upgrade_requires_single_line",
    "upgrade_requires_quantity_one",
    "product_not_sold"
  ]) {
    const message = upgradeErrorMessage(code)
    assert.ok(message.length > 10, `no wording for ${code}`)
    assert.ok(!message.includes(code), `${code} was shown to the customer verbatim`)
  }
})

test("an unknown error code falls back to safe wording that mentions no charge", () => {
  const message = upgradeErrorMessage("something_new_from_the_server")
  assert.match(message, /Nothing was charged/i)
})

test("the reserved-elsewhere message tells the customer what to DO", () => {
  assert.match(UPGRADE_COPY.reserved, /Finish or cancel/i)
})

// -- The cutover gate ---------------------------------------------------------

test("legacy term SKUs are not sellable, even while their rows stay active", () => {
  for (const slug of ["realvip-1m", "realvip-3m", "realvip-6m", "realvip-12m"]) {
    assert.equal(isPurchasableSlug(slug), false, `${slug} is still sellable`)
  }
})

test("the current permanent ranks ARE sellable", () => {
  assert.equal(isPurchasableSlug("realvip-permanent"), true)
  assert.equal(isPurchasableSlug("real-supporter-permanent"), true)
})

test("the server's sellable list and the storefront catalogue agree", () => {
  // The list is written out by hand so it cannot drift as a side effect of a
  // storefront edit. This is the guard that makes that safe.
  const catalogAvailable = CATALOG.filter((p) => p.availability === "available").map((p) => p.id).sort()
  const serverSellable = CATALOG.map((p) => p.id).filter(isPurchasableSlug).sort()
  assert.deepEqual(serverSellable, catalogAvailable)
})

test("coming-soon products are not sellable", () => {
  assert.equal(isPurchasableSlug("realfiction-plus-30d"), false)
  assert.equal(isPurchasableSlug("gift-card-25"), false)
})

test("a cart containing ANY unsellable line is refused whole", () => {
  const rejection = rejectUnsellableProducts([
    { slug: "real-supporter-permanent" },
    { slug: "realvip-1m" }
  ])
  assert.ok(rejection)
  assert.equal(rejection?.code, "product_not_sold")
  assert.equal(rejection?.status, 400)
})

test("a fully sellable cart passes", () => {
  assert.equal(
    rejectUnsellableProducts([{ slug: "realvip-permanent" }, { slug: "realpets-permanent" }]),
    null
  )
})

test("the refusal wording does not name the mechanism", () => {
  const rejection = rejectUnsellableProducts([{ slug: "realvip-1m" }])
  assert.ok(!/legacy|sku|catalog|inactive|active/i.test(rejection?.message ?? ""))
  assert.match(rejection?.message ?? "", /already own is unaffected/i)
})

test("a missing or empty slug is refused, never defaulted to sellable", () => {
  assert.ok(rejectUnsellableProducts([{ slug: null }]))
  assert.ok(rejectUnsellableProducts([{}]))
  assert.ok(rejectUnsellableProducts([{ slug: "" }]))
})

test("slug matching is case-insensitive on the way in, exact on the way out", () => {
  // A client sending REALVIP-1M must not slip past a lowercase-only set.
  assert.ok(rejectUnsellableProducts([{ slug: "REALVIP-1M" }]))
  assert.equal(rejectUnsellableProducts([{ slug: "REALVIP-PERMANENT" }]), null)
})
