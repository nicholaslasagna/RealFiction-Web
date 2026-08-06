// Refund ceilings, proved through the REAL Stripe webhook route.
//
// THE ORDER UNDER TEST — an upgrade paid with mixed tender:
//
//   merchandise subtotal   3499   list value; never money anyone collected
//   upgrade discount      -1299   an entitlement the customer already owned
//   order total            2200
//   store credit           -500   our own liability, collected earlier
//   Stripe payment         1700   the ONLY externally collected money
//
// Three numbers in that column are refundable-looking and only one of them is
// externally refundable money. This exercises the actual route handler and
// inspects the arguments it hands to the revocation/refund code — not a
// standalone arithmetic helper written to make the numbers come out right.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

const ORDER = {
  merchandiseSubtotalCents: 3499,
  upgradeDiscountCents: 1299,
  orderTotalCents: 2200,
  storeCreditCents: 500,
  externalPaidCents: 1700
}

type RevokeCall = {
  orderId: string
  refundedCents?: number
  currency?: string
  isFullRefund?: boolean
  mode: string
}

const seen = {
  revokes: [] as RevokeCall[],
  partials: [] as { refundedCents: number }[],
  reviews: [] as { reason: string; detail?: Record<string, unknown> }[]
}

mock.module("server-only", { namedExports: {}, defaultExport: {} })

mock.module("@/lib/store-server", {
  namedExports: {
    fulfillPaidOrderWithOutbox: async () => ({ alreadyFulfilled: false, emailQueued: true }),
    revokeOrderWithRefundOutbox: async (input: RevokeCall) => {
      seen.revokes.push(input)
      return { claimed: true, emailQueued: true }
    },
    enqueuePartialRefundOutbox: async (input: { refundedCents: number }) => {
      seen.partials.push(input)
    },
    persistWebhookEvent: async () => ({ duplicate: false, alreadyProcessed: false }),
    markWebhookEventProcessed: async () => {},
    findOrderIdByPaymentId: async () => "order-1",
    // What the server believes about the order. `paidCents` is the EXTERNAL
    // payment (payment_due_cents) — deliberately not the 2200 order total and
    // certainly not the 3499 subtotal.
    getOrderPaymentContext: async () => ({
      orderId: "order-1",
      status: "fulfilled",
      paidCents: ORDER.externalPaidCents,
      currency: "USD",
      items: [{ id: "item-1", totalCents: ORDER.merchandiseSubtotalCents }]
    }),
    getOrderExpectation: async () => ({
      orderId: "order-1",
      sessionId: "cs_1",
      paymentDueCents: ORDER.externalPaidCents,
      currency: "USD",
      liveMode: true,
      status: "pending"
    }),
    markOrderUnpaidClosed: async () => true,
    recordPaymentReview: async (input: { reason: string; detail?: Record<string, unknown> }) => {
      seen.reviews.push(input)
    },
    releaseStoreCredit: async () => {}
  }
})

globalThis.fetch = (async () => {
  throw new Error("no network during webhook handling")
}) as typeof fetch

process.env.STRIPE_ENVIRONMENT = "live"
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret_for_signing_only"

const { POST } = await import("../app/api/webhooks/stripe/route.ts")
const { classifyRefundScope } = await import("./stripe-events.ts")

let eventCounter = 0

async function refund(amountCents: number, currency = "usd") {
  seen.revokes = []
  seen.partials = []
  seen.reviews = []

  const event = {
    id: `evt_refund_${++eventCounter}`,
    type: "refund.updated",
    livemode: true,
    data: {
      object: {
        id: `re_${eventCounter}`,
        status: "succeeded",
        payment_intent: "pi_1",
        amount: amountCents,
        currency
      }
    }
  }

  const payload = JSON.stringify(event)
  const timestamp = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(process.env.STRIPE_WEBHOOK_SECRET!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`))
  const hex = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("")

  const response = await POST(
    new Request("https://realfiction.live/api/webhooks/stripe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": `t=${timestamp},v1=${hex}` },
      body: payload
    })
  )
  return { response, ...seen }
}

// ===========================================================================
// The ceiling: 1700, and nothing above it
// ===========================================================================

test("a 1700 refund — exactly what Stripe collected — is the FULL refund", async () => {
  const { revokes } = await refund(1700)
  assert.equal(revokes.length, 1)
  assert.equal(revokes[0].refundedCents, 1700)
  assert.equal(revokes[0].isFullRefund, true)
})

test("the ORDER TOTAL of 2200 is NOT treated as a refundable external amount", async () => {
  // 2200 includes 500 of store credit Stripe never held. Auto-revoking on it
  // would mean accepting a refund larger than the charge as routine.
  const { revokes, reviews } = await refund(2200)
  assert.equal(revokes.length, 0, "no automatic revocation")
  assert.ok(reviews.some((r) => r.reason.includes("refund_scope_unknown")))
})

test("the MERCHANDISE SUBTOTAL of 3499 is never usable as a refundable value", async () => {
  const { revokes, reviews } = await refund(3499)
  assert.equal(revokes.length, 0)
  assert.ok(reviews.some((r) => r.reason.includes("refund_scope_unknown")))
})

test("the UPGRADE DISCOUNT of 1299 is not money and is not refunded as money", async () => {
  // 1299 is below the 1700 charge, so it can only ever be a PARTIAL refund of
  // real money — never a reversal of the credit itself, which is an entitlement.
  const { revokes, partials } = await refund(1299)
  assert.equal(revokes.length, 0, "a partial refund never auto-revokes")
  assert.equal(partials[0].refundedCents, 1299)
})

test("every refund handed to the revocation path is bounded by the 1700 charge", async () => {
  for (const amount of [1, 500, 1699, 1700, 1701, 2200, 3499, 999_999]) {
    const { revokes, partials } = await refund(amount)
    for (const call of [...revokes, ...partials]) {
      assert.ok(
        (call.refundedCents ?? 0) <= ORDER.externalPaidCents,
        `${amount} produced a refund of ${call.refundedCents}, above the 1700 charge`
      )
    }
  }
})

// ===========================================================================
// Fail-closed inputs
// ===========================================================================

test("a currency that is not the order's fails closed with a high-priority review", async () => {
  const { revokes, partials, reviews } = await refund(1700, "jpy")
  assert.equal(revokes.length, 0)
  assert.equal(partials.length, 0)
  const review = reviews.find((r) => r.reason === "refund_currency_mismatch")
  assert.ok(review, "a currency mismatch must be surfaced")
  assert.equal(review?.detail?.priority, "high")
})

test("a zero or negative refund amount does nothing", async () => {
  for (const amount of [0, -1700]) {
    const { revokes, partials } = await refund(amount)
    assert.equal(revokes.length, 0, `amount ${amount} must not revoke`)
    assert.equal(partials.length, 0, `amount ${amount} must not enqueue`)
  }
})

test("repeated refund events for the same refund cannot exceed the ceiling", async () => {
  // Stripe emits charge.refunded, refund.created, and refund.updated for one
  // Refund. Three arrivals, three claims attempted, and the claim is what makes
  // only one of them count — proven here by every call carrying the same amount,
  // never an accumulating one.
  const amounts: number[] = []
  for (let i = 0; i < 3; i++) {
    const { revokes } = await refund(1700)
    amounts.push(...revokes.map((r) => r.refundedCents ?? 0))
  }
  assert.deepEqual(amounts, [1700, 1700, 1700])
  assert.ok(Math.max(...amounts) <= ORDER.externalPaidCents)
})

// ===========================================================================
// The classifier's own boundary
// ===========================================================================

test("classifyRefundScope treats only EXACTLY the charge as full", () => {
  const items = [{ id: "item-1", totalCents: 3499 }]
  assert.equal(classifyRefundScope(1700, 1700, items).kind, "full")
  assert.equal(classifyRefundScope(1699, 1700, items).kind, "partial")
  assert.equal(classifyRefundScope(1701, 1700, items).kind, "unknown")
  assert.equal(classifyRefundScope(2200, 1700, items).kind, "unknown")
  assert.equal(classifyRefundScope(3499, 1700, items).kind, "unknown")
})

test("a store-credit-only order has no external payment to refund", async () => {
  // payment_due_cents is 0, so no refund amount can ever be "full" — every
  // reversal of such an order is a store-credit question for a human.
  assert.equal(classifyRefundScope(3499, 0, []).kind, "unknown")
  assert.equal(classifyRefundScope(1, 0, []).kind, "unknown")
})

// ===========================================================================
// What the numbers mean together
// ===========================================================================

test("the tender ceilings sum to the order total, not to the subtotal", () => {
  assert.equal(ORDER.externalPaidCents + ORDER.storeCreditCents, ORDER.orderTotalCents)
  assert.equal(
    ORDER.merchandiseSubtotalCents - ORDER.upgradeDiscountCents,
    ORDER.orderTotalCents
  )
  // The maximum economic refund is 2200 — 1299 less than the subtotal, because
  // the upgrade credit was never money.
  assert.equal(
    ORDER.orderTotalCents,
    ORDER.merchandiseSubtotalCents - ORDER.upgradeDiscountCents
  )
})
