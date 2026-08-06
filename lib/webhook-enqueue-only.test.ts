// THE architectural guarantee: a verified Stripe webhook enqueues a durable
// email delivery and returns 2xx WITHOUT ever calling Resend.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

const calls = { resendFetch: 0, stripeFetch: 0, enqueue: 0, fulfil: 0 }
let enqueuedKeys: string[] = []
let reviews: string[] = []

mock.module("server-only", { namedExports: {}, defaultExport: {} })

mock.module("@/lib/store-server", {
  namedExports: {
    fulfillPaidOrderWithOutbox: async (orderId: string) => {
      // ONE atomic call: fulfilment AND the confirmation outbox row.
      calls.fulfil++
      calls.enqueue++
      enqueuedKeys.push(`order_confirmation:${orderId}`)
      return { alreadyFulfilled: false, emailQueued: true }
    },
    revokeOrderWithRefundOutbox: async (input: { refundId?: string | null }) => {
      calls.enqueue++
      if (input.refundId) {
        enqueuedKeys.push(`refund_confirmation:${input.refundId}`)
      }
      return { claimed: true, emailQueued: Boolean(input.refundId) }
    },
    enqueuePartialRefundOutbox: async (input: { refundId: string }) => {
      calls.enqueue++
      enqueuedKeys.push(`refund_confirmation:${input.refundId}`)
    },
    persistWebhookEvent: async () => ({ duplicate: false, alreadyProcessed: false }),
    markWebhookEventProcessed: async () => {},
    findOrderIdByPaymentId: async () => "order-1",
    getOrderPaymentContext: async () => ({
      orderId: "order-1",
      status: "fulfilled",
      paidCents: 1299,
      currency: "USD",
      items: []
    }),
    getOrderExpectation: async () => ({
      orderId: "order-1",
      sessionId: "cs_1",
      paymentDueCents: 1299,
      currency: "USD",
      liveMode: true,
      status: "pending"
    }),
    markOrderUnpaidClosed: async () => true,
    recordPaymentReview: async (input: { reason: string }) => {
      reviews.push(input.reason)
    },
    releaseStoreCredit: async () => {}
  }
})

// Any outbound HTTP at all is a failure of the architecture.
globalThis.fetch = (async (input: unknown) => {
  const url = String(input)
  if (url.includes("api.resend.com")) calls.resendFetch++
  if (url.includes("api.stripe.com")) calls.stripeFetch++
  throw new Error("no network during webhook handling")
}) as typeof fetch

process.env.STRIPE_ENVIRONMENT = "live"
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret_for_signing_only"

const { POST } = await import("../app/api/webhooks/stripe/route.ts")

async function signedRequest(event: Record<string, unknown>) {
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

  return new Request("https://realfiction.live/api/webhooks/stripe", {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${timestamp},v1=${hex}` },
    body: payload
  })
}

function reset() {
  calls.resendFetch = 0
  calls.stripeFetch = 0
  calls.enqueue = 0
  calls.fulfil = 0
  enqueuedKeys = []
  reviews = []
}

test("a paid checkout fulfils + enqueues atomically and calls Resend ZERO times", async () => {
  reset()
  const response = await POST(
    await signedRequest({
      id: "evt_paid_1",
      type: "checkout.session.completed",
      livemode: true,
      data: {
        object: {
          id: "cs_1",
          metadata: { order_id: "order-1" },
          payment_status: "paid",
          payment_intent: "pi_1",
          amount_total: 1299,
          currency: "usd"
        }
      }
    })
  )

  assert.equal(response.status, 200, "webhook returns 2xx")
  assert.equal(calls.fulfil, 1, "order was fulfilled")
  assert.equal(calls.enqueue, 1, "delivery was enqueued")
  assert.deepEqual(enqueuedKeys, ["order_confirmation:order-1"])
  assert.equal(calls.resendFetch, 0, "the webhook must NEVER await a Resend request")
})

test("a settled full refund enqueues exactly one refund email, keyed on the refund", async () => {
  reset()
  const refundEvent = (eventId: string) => ({
    id: eventId,
    type: "refund.updated",
    livemode: true,
    data: { object: { id: "re_123", status: "succeeded", payment_intent: "pi_1", amount: 1299, currency: "usd" } }
  })

  await POST(await signedRequest(refundEvent("evt_refund_created")))
  await POST(await signedRequest(refundEvent("evt_refund_updated")))

  // Two DIFFERENT Stripe events for the same refund -> the same delivery key,
  // which the database dedupes into one email.
  assert.deepEqual(enqueuedKeys, ["refund_confirmation:re_123", "refund_confirmation:re_123"])
  assert.equal(calls.resendFetch, 0)
})

test("a PENDING refund never enqueues a successful-refund email", async () => {
  reset()
  await POST(
    await signedRequest({
      id: "evt_refund_pending",
      type: "refund.created",
      livemode: true,
      data: { object: { id: "re_pending", status: "pending", payment_intent: "pi_1", amount: 1299 } }
    })
  )
  assert.equal(calls.enqueue, 0, "a pending refund is not a refund")
  assert.equal(calls.resendFetch, 0)
})

test("a FAILED refund never enqueues a successful-refund email", async () => {
  reset()
  await POST(
    await signedRequest({
      id: "evt_refund_failed",
      type: "refund.failed",
      livemode: true,
      data: { object: { id: "re_failed", status: "failed", payment_intent: "pi_1", amount: 1299 } }
    })
  )
  assert.equal(calls.enqueue, 0)
})

test("an unpaid session neither fulfils nor enqueues", async () => {
  reset()
  await POST(
    await signedRequest({
      id: "evt_unpaid",
      type: "checkout.session.completed",
      livemode: true,
      data: { object: { metadata: { order_id: "order-1" }, payment_status: "unpaid" } }
    })
  )
  assert.equal(calls.fulfil, 0)
  assert.equal(calls.enqueue, 0)
  assert.equal(calls.resendFetch, 0)
})

test("a test-mode event in live production does no work at all", async () => {
  reset()
  const response = await POST(
    await signedRequest({
      id: "evt_testmode",
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: "cs_1",
          metadata: { order_id: "order-1" },
          payment_status: "paid",
          amount_total: 1299,
          currency: "usd"
        }
      }
    })
  )
  assert.equal(response.status, 202)
  assert.equal(calls.fulfil, 0)
  assert.equal(calls.enqueue, 0)
  assert.equal(calls.resendFetch, 0)
})
