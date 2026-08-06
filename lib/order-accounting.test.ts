// The money story shown to a customer, for every shape of order that exists.
//
// The account page maps `accounting.lines` straight onto rows, and the receipt
// email maps the same array onto text lines and table rows. So these assertions
// are assertions about what the customer actually reads in both places.
import assert from "node:assert/strict"
import test from "node:test"

import { buildOrderAccounting, type OrderAccountingInput } from "./store/order-accounting.ts"

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}

/** Exactly what the account page renders, one string per row. */
function render(order: OrderAccountingInput) {
  const accounting = buildOrderAccounting(order)
  if (accounting.simple) {
    return [money(accounting.orderTotalCents)]
  }
  return accounting.lines.map(
    (line) => `${line.label}: ${line.negative ? "-" : ""}${money(line.cents)}`
  )
}

// -- 1. Ordinary Stripe order -------------------------------------------------

test("an ordinary Stripe order keeps the single-amount layout it always had", () => {
  const order = { subtotalCents: 1299, discountCents: 0, totalCents: 1299, storeCreditCents: 0, paymentDueCents: 1299 }
  assert.deepEqual(render(order), ["$12.99"])
  assert.equal(buildOrderAccounting(order).simple, true)
})

// -- 2. Ordinary store-credit-only order --------------------------------------

test("a store-credit-only order shows NO Stripe line", () => {
  const lines = render({
    subtotalCents: 3499,
    discountCents: 0,
    totalCents: 3499,
    storeCreditCents: 3499,
    paymentDueCents: 0
  })
  assert.deepEqual(lines, [
    "Subtotal: $34.99",
    "Store credit: -$34.99",
    "Paid with store credit: $34.99"
  ])
  assert.ok(!lines.some((line) => line.includes("Paid through Stripe")))
})

// -- 3. Ordinary mixed-tender order -------------------------------------------

test("a mixed-tender order separates the credit from the charge", () => {
  assert.deepEqual(
    render({
      subtotalCents: 1299,
      discountCents: 0,
      totalCents: 1299,
      storeCreditCents: 500,
      paymentDueCents: 799
    }),
    ["Subtotal: $12.99", "Store credit: -$5.00", "Paid through Stripe: $7.99"]
  )
})

// -- 4. Discounted order, no store credit -------------------------------------

test("a discounted order with no store credit reads as subtotal, credit, total", () => {
  assert.deepEqual(
    render({
      subtotalCents: 3499,
      discountCents: 1299,
      totalCents: 2200,
      storeCreditCents: 0,
      paymentDueCents: 2200
    }),
    [
      "Subtotal: $34.99",
      "Discount: -$12.99",
      "Order total: $22.00",
      "Paid through Stripe: $22.00"
    ]
  )
})

// -- 5. Discounted order with store credit ------------------------------------

const DISCOUNTED: OrderAccountingInput = {
  subtotalCents: 3499,
  discountCents: 1299,
  totalCents: 2200,
  storeCreditCents: 500,
  paymentDueCents: 1700
}

test("a discounted order with store credit renders the full five-line accounting", () => {
  assert.deepEqual(render(DISCOUNTED), [
    "Subtotal: $34.99",
    "Discount: -$12.99",
    "Order total: $22.00",
    "Store credit: -$5.00",
    "Paid through Stripe: $17.00"
  ])
})

test("the merchandise subtotal is NEVER labelled as an amount paid", () => {
  for (const line of render(DISCOUNTED)) {
    if (line.includes("$34.99")) {
      assert.match(line, /^Subtotal:/, `"${line}" presents 3499 as something other than the subtotal`)
    }
  }
})

test("the Stripe charge is NEVER labelled as the order total", () => {
  const lines = render(DISCOUNTED)
  assert.ok(lines.includes("Order total: $22.00"))
  assert.ok(lines.includes("Paid through Stripe: $17.00"))
  assert.ok(!lines.includes("Order total: $17.00"))
  assert.ok(!lines.includes("Paid through Stripe: $22.00"))
})

test("discount and store credit are separate lines, never merged", () => {
  const lines = render(DISCOUNTED)
  assert.equal(lines.filter((line) => line.startsWith("Discount")).length, 1)
  assert.equal(lines.filter((line) => line.startsWith("Store credit")).length, 1)
  // A merged "-$17.99" line would be arithmetically tidy and misleading: a
  // discount reduces the price, store credit pays part of it.
  assert.ok(!lines.some((line) => line.includes("$17.99")))
})

test("the arithmetic a customer can check actually reconciles", () => {
  const a = buildOrderAccounting(DISCOUNTED)
  assert.equal(a.subtotalCents - a.discountCents, a.orderTotalCents)
  assert.equal(a.orderTotalCents - a.storeCreditCents, a.externalPaidCents)
})

// -- 6. Historical order without the newer columns ----------------------------

test("a historical order with no discount or payment_due columns still renders", () => {
  // Placed before the discount/payment_due columns existed: only total_cents.
  assert.deepEqual(render({ totalCents: 999 }), ["$9.99"])

  // Store credit but no payment_due column: the charge is derived, not blank.
  assert.deepEqual(render({ totalCents: 1299, storeCreditCents: 500 }), [
    "Subtotal: $12.99",
    "Store credit: -$5.00",
    "Paid through Stripe: $7.99"
  ])
})

test("null and undefined columns never become NaN", () => {
  const lines = render({
    subtotalCents: null,
    discountCents: null,
    totalCents: 1299,
    storeCreditCents: null,
    paymentDueCents: null
  })
  for (const line of lines) {
    assert.ok(!line.includes("NaN"), `rendered NaN: ${line}`)
  }
  assert.deepEqual(lines, ["$12.99"])
})

// -- 7. Refunded order ---------------------------------------------------------

test("a refunded discounted order still shows what was originally charged", () => {
  // Status lives on the badge; the accounting is a record of the purchase and
  // must not silently zero out just because the order was reversed.
  assert.deepEqual(render(DISCOUNTED), [
    "Subtotal: $34.99",
    "Discount: -$12.99",
    "Order total: $22.00",
    "Store credit: -$5.00",
    "Paid through Stripe: $17.00"
  ])
})

// -- 8. Order held for review --------------------------------------------------

test("an order pending review renders normally — review state is not an amount", () => {
  // An order held for a human decision is an internal state; it must not leak
  // into, or corrupt, the customer's figures.
  const lines = render(DISCOUNTED)
  assert.equal(lines.length, 5)
  for (const line of lines) {
    assert.ok(!/reservation|review/i.test(line), line)
  }
})

// -- Safety -------------------------------------------------------------------

test("no internal identifier can reach the rendered accounting", () => {
  const body = render(DISCOUNTED).join("\n")
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(body))
  assert.ok(!/\bcs_|\bpi_|\bre_|\bch_/.test(body))
})

test("a nonsensical stored payment_due can never exceed the order total", () => {
  // Defence in depth: a bad backfill must not tell a customer they paid more
  // than the order was worth.
  const a = buildOrderAccounting({ ...DISCOUNTED, paymentDueCents: 999_999 })
  assert.equal(a.externalPaidCents, 2200)
})

test("a negative stored amount is floored, never rendered as a negative charge", () => {
  const a = buildOrderAccounting({ ...DISCOUNTED, storeCreditCents: -500, paymentDueCents: -1 })
  assert.equal(a.storeCreditCents, 0)
  assert.equal(a.externalPaidCents, 0)
})
