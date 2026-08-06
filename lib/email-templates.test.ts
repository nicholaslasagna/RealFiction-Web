import assert from "node:assert/strict"
import { register } from "node:module"
import test from "node:test"

// templates.ts imports the shared accounting module by TypeScript-style
// extensionless path; the hook resolves those for `node --test`.
register("./test-alias-hook.mjs", import.meta.url)

import type { OrderEmailData } from "./email/templates.ts"

// Dynamic: static imports hoist above register(), and templates.ts reaches the
// shared accounting module by an extensionless path the hook has to resolve.
const { buildOrderConfirmationEmail, escapeHtml, formatDate, formatMoney, orderNumber } =
  await import("./email/templates.ts")

const BASE: OrderEmailData = {
  orderId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  purchasedAt: "2026-07-18T12:00:00.000Z",
  deliveryUsername: "LittleNicholas",
  isGift: false,
  giftRecipient: null,
  items: [
    {
      name: "RealVIP · 3 Months",
      quantity: 1,
      durationLabel: "3 Months",
      totalCents: 1299,
      expiresAt: "2026-10-16T12:00:00.000Z"
    }
  ],
  subtotalCents: 1299,
  storeCreditCents: 0,
  totalPaidCents: 1299,
  currency: "USD",
  fulfillmentStatus: "fulfilled",
  supportEmail: "support@realfiction.live",
  siteUrl: "https://realfiction.live",
  stripeReceiptUrl: "https://pay.stripe.com/receipts/abc123"
}

test("order number is stable, human-quotable, and derived from the order id", () => {
  assert.equal(orderNumber(BASE.orderId), "RF-3F2504E0")
  assert.equal(orderNumber(BASE.orderId), orderNumber(BASE.orderId))
})

test("confirmation includes every required field", () => {
  const email = buildOrderConfirmationEmail(BASE)
  const body = `${email.subject}\n${email.text}`

  assert.match(body, /RF-3F2504E0/, "order number")
  assert.match(body, /RealVIP/, "item name")
  assert.match(body, /3 Months/, "duration")
  assert.match(body, /\$12\.99/, "total")
  assert.match(body, /LittleNicholas/, "delivery account")
  assert.match(body, /October 16, 2026/, "entitlement expiration")
  assert.match(body, /support@realfiction\.live/, "support contact")
  assert.match(body, /https:\/\/realfiction\.live\/account/, "order history link")
  assert.match(body, /pay\.stripe\.com\/receipts/, "payment receipt link")
})

test("quantity appears when more than one is bought", () => {
  const email = buildOrderConfirmationEmail({
    ...BASE,
    items: [{ ...BASE.items[0], quantity: 3, totalCents: 3897 }]
  })
  assert.match(email.text, /x3/)
  assert.match(email.text, /\$38\.97/)
})

test("store credit is itemised only when it was applied", () => {
  const withoutCredit = buildOrderConfirmationEmail(BASE)
  assert.doesNotMatch(withoutCredit.text, /Store credit/)

  const withCredit = buildOrderConfirmationEmail({
    ...BASE,
    storeCreditCents: 500,
    totalPaidCents: 799
  })
  assert.match(withCredit.text, /Store credit: -\$5\.00/)
  // Renamed from "Total paid": once store credit is applied, the externally
  // collected amount is NOT the order total, and must not be labelled as one.
  assert.match(withCredit.text, /Paid through Stripe: \$7\.99/)
})

test("an unfulfilled-but-paid order says delivery is in progress", () => {
  const email = buildOrderConfirmationEmail({ ...BASE, fulfillmentStatus: "paid" })
  assert.match(email.text, /being delivered/i)
  assert.doesNotMatch(email.text, /active in-game now/i)
})

test("a gift addresses the recipient, not the buyer's own account", () => {
  const email = buildOrderConfirmationEmail({
    ...BASE,
    isGift: true,
    giftRecipient: "FriendName",
    deliveryUsername: "LittleNicholas"
  })
  assert.match(email.subject, /gift/i)
  assert.match(email.text, /Gift for: FriendName/)
  assert.doesNotMatch(email.text, /Delivered to: LittleNicholas/)
})

test("a non-expiring item omits the expiry line rather than printing a bad date", () => {
  const email = buildOrderConfirmationEmail({
    ...BASE,
    items: [{ ...BASE.items[0], expiresAt: null, durationLabel: null }]
  })
  assert.doesNotMatch(email.text, /Access through/)
})

test("an unparseable date never renders as Invalid Date", () => {
  assert.equal(formatDate("not-a-date"), null)
  assert.equal(formatDate(null), null)
  const email = buildOrderConfirmationEmail({ ...BASE, purchasedAt: "garbage" })
  assert.doesNotMatch(email.text, /Invalid Date/)
  assert.match(email.text, /Placed recently/)
})

test("the receipt link is omitted when Stripe has not produced one", () => {
  const email = buildOrderConfirmationEmail({ ...BASE, stripeReceiptUrl: null })
  assert.doesNotMatch(email.text, /Payment receipt/)
  assert.doesNotMatch(email.html, /Payment receipt/)
})

// -- The security requirement ------------------------------------------------

test("email content NEVER contains payment, secret, or internal identifiers", () => {
  const email = buildOrderConfirmationEmail({
    ...BASE,
    storeCreditCents: 500,
    totalPaidCents: 799,
    isGift: true,
    giftRecipient: "FriendName"
  })
  const body = `${email.subject}\n${email.text}\n${email.html}`

  const forbidden: Array<[RegExp, string]> = [
    [/sk_(test|live)_/, "Stripe secret key"],
    [/whsec_/, "webhook signing secret"],
    [/\bpi_[A-Za-z0-9]/, "PaymentIntent id"],
    [/\bcs_(test|live)_/, "Checkout Session id"],
    [/\bch_[A-Za-z0-9]/, "Charge id"],
    [/\bevt_[A-Za-z0-9]/, "Stripe event id"],
    [/service_role/, "service-role reference"],
    [/hmac/i, "HMAC material"],
    [/\b\d{13,19}\b/, "card-number-length digit run"],
    [/\bcvv|cvc\b/i, "card verification value"],
    [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, "raw UUID"]
  ]

  for (const [pattern, label] of forbidden) {
    assert.doesNotMatch(body, pattern, `email must not contain ${label}`)
  }
})

test("the raw order UUID is never exposed — only the short order number", () => {
  const email = buildOrderConfirmationEmail(BASE)
  const body = `${email.subject}\n${email.text}\n${email.html}`
  assert.doesNotMatch(body, /3f2504e0-4f89-41d3-9a0c-0305e82c3301/i)
})

test("interpolated values are HTML-escaped", () => {
  assert.equal(escapeHtml(`<script>&"'`), "&lt;script&gt;&amp;&quot;&#39;")

  const email = buildOrderConfirmationEmail({
    ...BASE,
    deliveryUsername: '<img src=x onerror="alert(1)">',
    items: [{ ...BASE.items[0], name: "<b>Injected</b>" }]
  })
  assert.doesNotMatch(email.html, /<img src=x/)
  assert.doesNotMatch(email.html, /<b>Injected<\/b>/)
  assert.match(email.html, /&lt;b&gt;Injected/)
})

test("money formatting is currency-correct and cent-accurate", () => {
  assert.equal(formatMoney(1299), "$12.99")
  assert.equal(formatMoney(0), "$0.00")
  assert.equal(formatMoney(100000), "$1,000.00")
})

// -- Discounted-order presentation --------------------------------------------

const DISCOUNTED_ORDER = {
  orderId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  purchasedAt: "2026-07-27T10:00:00Z",
  deliveryUsername: "Tester",
  isGift: false,
  giftRecipient: null,
  items: [
    {
      name: "RealSupporter · 3 months",
      quantity: 1,
      durationLabel: "3 months",
      totalCents: 3499,
      expiresAt: null
    }
  ],
  subtotalCents: 3499,
  upgradeDiscountCents: 1299,
  storeCreditCents: 500,
  totalPaidCents: 1700,
  currency: "USD",
  fulfillmentStatus: "fulfilled",
  supportEmail: "support@realfiction.live",
  siteUrl: "https://realfiction.live",
  stripeReceiptUrl: null
}

test("a discounted order shows the full accounting, and the numbers reconcile", () => {
  const email = buildOrderConfirmationEmail(DISCOUNTED_ORDER)

  for (const form of [email.text, email.html]) {
    assert.match(form, /\$34\.99/, "merchandise subtotal")
    assert.match(form, /-\$12\.99/, "upgrade credit as a negative line")
    assert.match(form, /\$22\.00/, "order total after the discount")
    assert.match(form, /-\$5\.00/, "store credit as a separate negative line")
    assert.match(form, /\$17\.00/, "externally paid amount")
  }

  // The arithmetic the customer can check: 3499 - 1299 = 2200; 2200 - 500 = 1700.
  assert.equal(
    DISCOUNTED_ORDER.subtotalCents - DISCOUNTED_ORDER.upgradeDiscountCents,
    2200
  )
  assert.equal(2200 - DISCOUNTED_ORDER.storeCreditCents, DISCOUNTED_ORDER.totalPaidCents)
})

test("discount and store credit are SEPARATE lines, never merged", () => {
  const email = buildOrderConfirmationEmail(DISCOUNTED_ORDER)
  assert.match(email.text, /Discount/)
  assert.match(email.text, /Store credit/)
  assert.match(email.html, /Discount/)
})

test("the externally paid amount is never labelled the order total", () => {
  const email = buildOrderConfirmationEmail(DISCOUNTED_ORDER)
  // $17.00 must be described as paid through Stripe, and $22.00 as the total.
  assert.match(email.text, /Order total: \$22\.00/)
  assert.match(email.text, /Paid through Stripe: \$17\.00/)
  assert.doesNotMatch(email.text, /Order total: \$17\.00/)
})

test("an ordinary order without a discount keeps its previous shape", () => {
  const email = buildOrderConfirmationEmail({
    ...DISCOUNTED_ORDER,
    upgradeDiscountCents: 0,
    storeCreditCents: 0,
    subtotalCents: 3499,
    totalPaidCents: 3499
  })
  assert.doesNotMatch(email.text, /upgrade credit/i, "no discount line when there is no discount")
  assert.doesNotMatch(email.text, /Store credit/i)
  assert.match(email.text, /Paid through Stripe: \$34\.99/)
})

test("a store-credit-only order shows no misleading Stripe line", () => {
  const email = buildOrderConfirmationEmail({
    ...DISCOUNTED_ORDER,
    upgradeDiscountCents: 0,
    storeCreditCents: 3499,
    subtotalCents: 3499,
    totalPaidCents: 0
  })
  assert.doesNotMatch(email.text, /Paid through Stripe/, "nothing was paid through Stripe")
  assert.match(email.text, /Paid with store credit: \$34\.99/)
})

test("a discounted order with no store credit reads correctly", () => {
  const email = buildOrderConfirmationEmail({
    ...DISCOUNTED_ORDER,
    storeCreditCents: 0,
    totalPaidCents: 2200
  })
  assert.match(email.text, /Order total: \$22\.00/)
  assert.match(email.text, /Paid through Stripe: \$22\.00/)
  assert.doesNotMatch(email.text, /Store credit/)
})

test("HTML and plain text agree on every figure", () => {
  const email = buildOrderConfirmationEmail(DISCOUNTED_ORDER)
  for (const amount of ["$34.99", "$12.99", "$22.00", "$5.00", "$17.00"]) {
    assert.ok(email.text.includes(amount), `text missing ${amount}`)
    assert.ok(email.html.includes(amount), `html missing ${amount}`)
  }
})

test("a legacy order object without the discount field still renders", () => {
  const { upgradeDiscountCents, ...legacy } = DISCOUNTED_ORDER
  void upgradeDiscountCents
  assert.doesNotThrow(() => buildOrderConfirmationEmail(legacy))
})
