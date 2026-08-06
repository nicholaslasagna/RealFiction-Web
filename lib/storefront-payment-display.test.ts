// Storefront payment presentation.
//
// Stripe Checkout is the source of truth for which methods a buyer is offered.
// The storefront must not imply a fixed set — and must never call Stripe from
// the browser just to decorate the page.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

const repoRoot = path.resolve(import.meta.dirname, "..")
const storefront = readFileSync(path.join(repoRoot, "components", "storefront.tsx"), "utf8")

test("no card-brand logos are presented as the accepted set", () => {
  assert.doesNotMatch(storefront, /payments\/visa\.svg/)
  assert.doesNotMatch(storefront, /payments\/mastercard\.svg/)
  assert.doesNotMatch(storefront, /payments\/amex\.svg/)
  assert.doesNotMatch(storefront, /payments\/paypal\.svg/)
  // The PayMark logo component is gone entirely, not just unused.
  assert.doesNotMatch(storefront, /function PayMark/)
})

test("the copy defers to Stripe and does not guarantee specific methods", () => {
  assert.match(storefront, /Secure checkout through Stripe/)
  assert.match(
    storefront,
    /Eligible payment methods are shown at checkout based on your location, device,\s*\n?\s*currency, and purchase amount\./
  )
})

test("the representative method row is decorative, not a promise", () => {
  const row = /Cards · Apple Pay · Google Pay · Link · Cash App Pay · More/
  assert.match(storefront, row)
  // Marked aria-hidden: it is illustrative, and a screen reader announcing it
  // would read as a list of guaranteed options.
  const index = storefront.search(row)
  const preceding = storefront.slice(Math.max(0, index - 200), index)
  assert.match(preceding, /aria-hidden/)
})

test("the browser never calls Stripe to populate the display", () => {
  assert.doesNotMatch(storefront, /api\.stripe\.com/)
  assert.doesNotMatch(storefront, /stripe\.js|loadStripe/)
})

test("checkout is disabled for an empty or zero-value cart", () => {
  assert.match(storefront, /const hasPayableCart = cartLines\.length > 0 && total > 0/)
  assert.match(storefront, /const canCheckout = signedIn && hasPayableCart && deliveryReady/)
})

test("the checkout button keeps its disabled state and an accessible label", () => {
  assert.match(storefront, /aria-label="Secure checkout through Stripe"/)
  assert.match(storefront, /disabled=\{!canCheckout \|\| checkoutBusy\}/)
})

test("no tiny fixed-size logo images remain", () => {
  // The old marks were 16px-tall raster-ish pills; nothing that small should
  // carry meaning any more.
  assert.doesNotMatch(storefront, /h-\[16px\]/)
  assert.doesNotMatch(storefront, /h-\[26px\]/)
})

test("the cart validity gate uses the MERCHANDISE subtotal, not the post-credit amount", () => {
  // `total` is the sum of line totals (pre-credit); `dueCents` is what Stripe
  // would charge. Gating on dueCents would wrongly disable checkout for a
  // positive-value cart fully covered by store credit.
  assert.match(storefront, /const total = cartLines\.reduce\(\(sum, item\) => sum \+ item\.total, 0\)/)
  assert.match(storefront, /const dueCents = total - creditToApply/)
  assert.match(storefront, /const hasPayableCart = cartLines\.length > 0 && total > 0/)
  assert.doesNotMatch(storefront, /hasPayableCart = [^\n]*dueCents/)
})
