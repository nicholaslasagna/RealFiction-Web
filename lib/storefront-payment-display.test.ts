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

test("brand marks are shown, but never PayPal (disabled server-side)", () => {
  for (const mark of ["visa", "mastercard", "amex", "apple-pay", "google-pay"]) {
    assert.match(storefront, new RegExp(`payments/${mark}\\.svg`), `${mark} mark should be shown`)
  }
  // PayPal is sandbox-only and refused by the server; showing it would advertise
  // a method that cannot complete.
  assert.doesNotMatch(storefront, /payments\/paypal\.svg/)
})

test("the brand row is labelled as EXAMPLES, not an accepted-methods list", () => {
  // A screen reader must hear one honest sentence, not a brand list that reads
  // like a guarantee — so the group carries the name and the marks are alt="".
  assert.match(storefront, /role="img"/)
  assert.match(storefront, /aria-label="Example payment methods/)
  assert.match(storefront, /The methods available to you are shown at checkout\./)
  // Formatting-agnostic: the attributes may sit on separate lines.
  assert.match(storefront, /alt=""\s+aria-hidden/, "individual marks are decorative")
})

test("the row signals it is not exhaustive", () => {
  assert.match(storefront, /\+ more/)
})

test("the copy defers to Stripe and does not guarantee specific methods", () => {
  assert.match(storefront, /Secure checkout through Stripe/)
  assert.match(
    storefront,
    /Eligible payment methods are shown at checkout based on your location, device,\s*\n?\s*currency, and purchase amount\./
  )
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

test("logo images are large enough to read", () => {
  // The previous marks were 16px tall in 26px pills — too small. Marks are now
  // h-5 (20px) inside h-8 (32px) pills.
  assert.doesNotMatch(storefront, /h-\[16px\]/)
  assert.doesNotMatch(storefront, /h-\[26px\]/)
  // Sized so the WIDE wordmarks are not squeezed: a 58px pill with an 18px
  // height cap renders every mark at 15-18px tall.
  assert.match(storefront, /max-h-\[18px\] max-w-\[46px\]/)
  assert.match(storefront, /inline-flex h-9 w-\[58px\]/)
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
