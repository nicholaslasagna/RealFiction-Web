// "Do I currently own this?" — the rule, in one place.
//
// THE BUG THIS EXISTS FOR
// =======================
// The account page reported two one-month purchases from 30 May 2026 as `Owned`
// indefinitely, and counted them toward "Perks owned 2 of 6", while the store
// correctly showed them as expired on 29 June 2026. The account page derived
// ownership from the mere EXISTENCE of an entitlement row, applying neither the
// status nor the date.
//
// `entitlements.status` stays `active` on a term grant after its date passes —
// nothing sweeps the column, and nothing should, because the row is the record
// of a real purchase. Ownership is therefore a function of the DATE.
import assert from "node:assert/strict"
import { test } from "node:test"

import { accessStateFor, activeEntitlementSlugs } from "./store/access-view.ts"

/** The reported incident, to the day. */
const PURCHASED = Date.parse("2026-05-30T12:00:00.000Z")
const EXPIRES = Date.parse("2026-06-29T12:00:00.000Z")
const TODAY = Date.parse("2026-08-07T12:00:00.000Z")

const row = (key: string, expiresAt: string | null, status = "active") => ({
  entitlement_key: key,
  status,
  expires_at: expiresAt
})

// ===========================================================================
// 1 & 2 — the core rule
// ===========================================================================

test("1. an entitlement expiring in the FUTURE is owned", () => {
  const active = activeEntitlementSlugs(
    [row("product:realvip-1m", new Date(TODAY + 86_400_000).toISOString())],
    TODAY
  )
  assert.deepEqual([...active], ["realvip-1m"])
})

test("2. an EXPIRED entitlement is NOT owned, even with status active", () => {
  // The exact reported case: bought 30 May, one month, still `status: active`.
  const active = activeEntitlementSlugs(
    [row("product:realvip-1m", new Date(EXPIRES).toISOString(), "active")],
    TODAY
  )
  assert.deepEqual([...active], [], "an expired grant must not count as owned")
  assert.ok(TODAY > EXPIRES, "sanity: the fixture really is in the past")
})

test("the store and the account page now agree on the same rows", () => {
  // The two surfaces disagreed. Same input, same verdict is the actual fix.
  const rows = [row("product:realvip-1m", new Date(EXPIRES).toISOString())]

  const accountSaysOwned = activeEntitlementSlugs(rows, TODAY).size > 0
  const storeState = accessStateFor(
    "realvip",
    [{ productId: "realvip", expiresAt: new Date(EXPIRES).toISOString() }],
    TODAY
  )

  assert.equal(accountSaysOwned, false)
  assert.equal(storeState.kind, "expired")
  assert.equal(accountSaysOwned, storeState.kind === "active", "the two surfaces disagree")
})

// ===========================================================================
// 3 — the count
// ===========================================================================

test("3. an expired entitlement does NOT increment Perks owned", () => {
  const perks = [
    { key: "vip", slugs: ["realvip", "real-supporter"] },
    { key: "supporter", slugs: ["real-supporter"] },
    { key: "cosmetic", slugs: ["cosmetic-atelier"] },
    { key: "pets", slugs: ["realpets"] },
    { key: "particles", slugs: ["particle-vault"] },
    { key: "colors", slugs: ["username-colors"] }
  ]
  const base = (slug: string) => slug.replace(/-(1m|3m|6m|12m|permanent|30d)$/, "")

  const expired = [
    row("product:realvip-1m", new Date(EXPIRES).toISOString()),
    row("product:real-supporter-1m", new Date(EXPIRES).toISOString())
  ]

  const owned = new Set([...activeEntitlementSlugs(expired, TODAY)].map(base))
  const count = perks.filter((p) => p.slugs.some((s) => owned.has(s))).length

  assert.equal(count, 0, 'the reported "Perks owned: 2 of 6" must become 0 of 6')
})

// ===========================================================================
// 4 — history is preserved
// ===========================================================================

test("4. the historical purchase rows are NOT mutated or dropped", () => {
  const rows = [
    row("product:realvip-1m", new Date(EXPIRES).toISOString()),
    row("product:real-supporter-1m", new Date(EXPIRES).toISOString())
  ]
  const snapshot = JSON.parse(JSON.stringify(rows))

  activeEntitlementSlugs(rows, TODAY)

  // The function is a read. All Purchases renders from these same rows, so
  // filtering them in place would erase the customer's history.
  assert.deepEqual(rows, snapshot, "the input rows were modified")
  assert.equal(rows.length, 2, "a historical row disappeared")
})

// ===========================================================================
// 5 — independence
// ===========================================================================

test("5. RealVIP and RealSupporter expire independently", () => {
  const active = activeEntitlementSlugs(
    [
      row("product:realvip-1m", new Date(TODAY + 86_400_000).toISOString()),
      row("product:real-supporter-1m", new Date(EXPIRES).toISOString())
    ],
    TODAY
  )

  assert.ok(active.has("realvip-1m"), "the live RealVIP was dropped")
  assert.ok(!active.has("real-supporter-1m"), "the expired RealSupporter leaked through")
})

// ===========================================================================
// 6 — stacking
// ===========================================================================

test("6. stacked purchases stay active until the FINAL expiration", () => {
  // One lapsed row and one live row for the same product: still owned.
  const active = activeEntitlementSlugs(
    [
      row("product:realvip-1m", new Date(EXPIRES).toISOString()),
      row("product:realvip-3m", new Date(TODAY + 30 * 86_400_000).toISOString())
    ],
    TODAY
  )
  assert.ok(active.has("realvip-3m"), "the still-live stacked grant was dropped")

  // And once the furthest-out date passes, it is over.
  const later = activeEntitlementSlugs(
    [
      row("product:realvip-1m", new Date(EXPIRES).toISOString()),
      row("product:realvip-3m", new Date(TODAY + 30 * 86_400_000).toISOString())
    ],
    TODAY + 400 * 86_400_000
  )
  assert.equal(later.size, 0, "ownership outlived the final expiration")
})

// ===========================================================================
// Edges that decide whether this fails safe
// ===========================================================================

test("a REVOKED or refunded grant is never owned, however far out its date", () => {
  for (const status of ["revoked", "refunded", "cancelled"]) {
    const active = activeEntitlementSlugs(
      [row("product:realvip-12m", new Date(TODAY + 999 * 86_400_000).toISOString(), status)],
      TODAY
    )
    assert.equal(active.size, 0, `status "${status}" was treated as owned`)
  }
})

test("a permanent grant (no expiry) stays owned", () => {
  const active = activeEntitlementSlugs([row("product:realvip-permanent", null)], TODAY)
  assert.deepEqual([...active], ["realvip-permanent"])
})

test("an UNPARSEABLE expiry is treated as expired, not as permanent", () => {
  // Failing the other way would grant access forever on a corrupt value.
  const active = activeEntitlementSlugs([row("product:realvip-1m", "not-a-date")], TODAY)
  assert.equal(active.size, 0)
})

test("expiry is exclusive at the exact instant", () => {
  const at = new Date(TODAY).toISOString()
  assert.equal(activeEntitlementSlugs([row("product:realvip-1m", at)], TODAY).size, 0)
  assert.equal(activeEntitlementSlugs([row("product:realvip-1m", at)], TODAY - 1).size, 1)
})
