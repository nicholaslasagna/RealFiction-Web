// Storefront presentation invariants.
//
// Source-level assertions: these catch the class of regression that a component
// unit test misses — a card quietly losing its billing disclosure, gift cards
// becoming buyable again, or auto-renew language appearing for a pass that does
// not renew.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

const repoRoot = path.resolve(import.meta.dirname, "..")
const storefront = readFileSync(path.join(repoRoot, "components", "storefront.tsx"), "utf8")
const comparison = readFileSync(path.join(repoRoot, "components", "store", "rank-comparison.tsx"), "utf8")
const fairPlay = readFileSync(path.join(repoRoot, "components", "store", "fair-play.tsx"), "utf8")
const storePage = readFileSync(path.join(repoRoot, "app", "store", "page.tsx"), "utf8")
const dataSource = readFileSync(path.join(repoRoot, "lib", "data.ts"), "utf8")

test("every product card renders its billing disclosure", () => {
  assert.match(storefront, /product\.disclosure\.map/, "cards must render the disclosure lines")
})

test("no auto-renew or cancellation language anywhere in the store UI", () => {
  // Nothing here renews itself. Copy implying otherwise would be a lie, and a
  // cancel button for a non-recurring pass would be worse.
  for (const [name, source] of [
    ["storefront", storefront],
    ["comparison", comparison],
    ["store page", storePage]
  ] as const) {
    assert.doesNotMatch(source, /auto-?renew/i, `${name} implies automatic renewal`)
    assert.doesNotMatch(source, /charged monthly/i, `${name} implies recurring billing`)
    assert.doesNotMatch(source, /cancel (your )?subscription/i, `${name} offers cancellation`)
  }
})

test("gift cards are presented as coming soon, never purchasable", () => {
  assert.match(storefront, /Coming soon/i)
  // The gift-card branch must not wire an add-to-cart action.
  const giftBranch = storefront.slice(
    storefront.indexOf("{isGiftCards ? ("),
    storefront.indexOf(") : (")
  )
  assert.doesNotMatch(giftBranch, /addToCart/, "gift cards must have no purchase action")
  assert.doesNotMatch(giftBranch, /Add to cart/i)
})

test("the storefront no longer sells retired term SKUs", () => {
  // Legacy 1m/3m/6m/12m slugs are inactive server-side; offering them would
  // produce a checkout that always fails.
  assert.doesNotMatch(dataSource, /"realvip-1m"/)
  assert.doesNotMatch(dataSource, /slug: "[a-z-]+-(1m|3m|6m|12m)"/)
  assert.doesNotMatch(storefront, /DURATION_LABEL/, "tier labels are gone")
})

test("ownership comes from a server-provided prop, never inferred client-side", () => {
  assert.match(storefront, /ownedProductIds/)
  assert.match(storePage, /getOwnedProductIds/)
  // The store page resolves it on the server and passes it down.
  assert.match(storePage, /ownedProductIds=\{ownedProductIds\}/)
})

test("owned or already-included products offer NO purchase control at all", () => {
  // Stronger than the disabled button this replaced: a greyed-out "Add to cart"
  // reads as temporarily unavailable, and its label overflowed the button at
  // 320px. An owned card now renders the ownership badge and nothing to click.
  assert.match(storefront, /cardLocked \? \(/)
  assert.ok(!/disabled=\{cardLocked\}/.test(storefront), "an owned card must not render a disabled button")
})

test("term products disclose what is retained and what ends", () => {
  assert.match(storefront, /You keep after it ends/)
  assert.match(storefront, /Ends with the pass/)
})

test("the comparison is a real table with scoped headers", () => {
  assert.match(comparison, /<table/)
  assert.match(comparison, /scope="col"/)
  assert.match(comparison, /scope="row"/)
  assert.match(comparison, /<caption/, "a data table needs a caption for screen readers")
  // Wide content scrolls in its own container, not the page body.
  assert.match(comparison, /overflow-x-auto/)
})

test("comparison ticks and dashes are not icon-only for screen readers", () => {
  assert.match(comparison, /sr-only">Included/)
  assert.match(comparison, /sr-only">Not included/)
})

test("the Fair Play Promise is a product promise, not a legal claim", () => {
  assert.match(fairPlay, /Fair Play Promise/)
  // Assert on what a customer READS, not on the source comments — a comment
  // explaining that we avoid legal claims is not itself a legal claim.
  const copy = fairPlay.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  assert.doesNotMatch(copy, /complian(t|ce)/i, "do not assert legal compliance")
  assert.doesNotMatch(copy, /guarantee[sd]? by law/i)
  assert.doesNotMatch(copy, /legally/i)
})

test("store sections are labelled for assistive tech", () => {
  assert.match(fairPlay, /aria-labelledby="fair-play-heading"/)
  assert.match(comparison, /aria-labelledby="comparison-heading"/)
})
