// Gift-card refunds and disputes through the REAL signed Stripe webhook.
//
// THE INVARIANT UNDER TEST
// ========================
// A gift-card purchase must never reach `revoke_order`. That path reverses
// entitlements and queues RealCore rewards; a gift card has neither and is
// `consumable`, so it would do almost nothing — and crucially would NOT
// invalidate the claim credential, void the card, or reverse the stored value.
// Refunding a claimed card through it returns the money and leaves the credit
// spendable. Every test here watches for that.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

const CARD_ID = "7b000000-0000-4000-8000-000000000001"
const ORDER_ID = "7c000000-0000-4000-8000-000000000001"

const db = {
  giftCardForOrder: CARD_ID as string | null,
  classifierFails: false,
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  ordinaryRevokes: 0,
  refundRows: [] as { id: string; state: string; eligible_external_cents: number }[],
  reviews: [] as string[]
}

mock.module("server-only", { namedExports: {}, defaultExport: {} })

mock.module("@/lib/supabase/service-role", {
  namedExports: {
    getSupabaseServiceRoleClient: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        db.rpcCalls.push({ fn, args })

        if (fn === "gift_card_for_order") {
          if (db.classifierFails) {
            return { data: null, error: { message: "connection reset" } }
          }
          return { data: db.giftCardForOrder, error: null }
        }
        if (fn === "begin_gift_card_refund") {
          const row = { refund_id: "refund-1", state: "eligible_unclaimed", eligible_external_cents: 2500 }
          db.refundRows.push({ id: row.refund_id, state: row.state, eligible_external_cents: 2500 })
          return { data: [row], error: null }
        }
        if (fn === "complete_gift_card_refund") {
          return { data: [{ outcome: "completed", reversed_cents: 0 }], error: null }
        }
        if (fn === "record_gift_card_dispute") {
          return { data: [{ outcome: "claimed_frozen", frozen_cents: 1201, downstream_orders: 1 }], error: null }
        }
        if (fn === "resolve_gift_card_dispute") {
          const won = args.p_outcome === "won"
          return {
            data: [{ outcome: won ? "won_unfrozen" : "lost_frozen", unfrozen_cents: won ? 1201 : 0 }],
            error: null
          }
        }
        return { data: null, error: null }
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: db.refundRows[0] ?? null })
          })
        })
      })
    })
  }
})

mock.module("@/lib/store-server", {
  namedExports: {
    persistWebhookEvent: async () => ({ duplicate: false, alreadyProcessed: false }),
    markWebhookEventProcessed: async () => {},
    findOrderIdByPaymentId: async () => ORDER_ID,
    getOrderExpectation: async () => null,
    getOrderPaymentContext: async () => ({
      orderId: ORDER_ID,
      status: "fulfilled",
      paidCents: 2500,
      currency: "USD",
      items: []
    }),
    // If EITHER of these runs for a gift card, the dispatch guard failed.
    revokeOrderWithRefundOutbox: async () => {
      db.ordinaryRevokes++
      return { claimed: true, emailQueued: true }
    },
    enqueuePartialRefundOutbox: async () => {
      db.ordinaryRevokes++
    },
    fulfillPaidOrderWithOutbox: async () => ({ alreadyFulfilled: false, emailQueued: false }),
    recordPaymentReview: async (input: { reason: string }) => {
      db.reviews.push(input.reason)
    },
    markOrderUnpaidClosed: async () => true,
    releaseStoreCredit: async () => {}
  }
})

globalThis.fetch = (async () => {
  throw new Error("no network during webhook handling")
}) as typeof fetch

process.env.STRIPE_ENVIRONMENT = "live"
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret_for_signing_only"

const { POST } = await import("../app/api/webhooks/stripe/route.ts")

async function signed(event: Record<string, unknown>) {
  const payload = JSON.stringify(event)
  const ts = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(process.env.STRIPE_WEBHOOK_SECRET!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${payload}`))
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("")
  return new Request("https://realfiction.live/api/webhooks/stripe", {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${ts},v1=${hex}` },
    body: payload
  })
}

let seq = 0
const refundEvent = (amount = 2500) => ({
  id: `evt_refund_${++seq}`,
  type: "refund.updated",
  livemode: true,
  data: {
    object: { id: `re_${seq}`, status: "succeeded", payment_intent: "pi_1", amount, currency: "usd" }
  }
})

const disputeCreated = () => ({
  id: `evt_dispute_${++seq}`,
  type: "charge.dispute.created",
  livemode: true,
  data: { object: { id: `dp_${seq}`, amount: 2500, currency: "usd", payment_intent: "pi_1" } }
})

const disputeClosed = (status: string) => ({
  id: `evt_closed_${++seq}`,
  type: "charge.dispute.closed",
  livemode: true,
  data: { object: { id: `dp_${seq}`, status, amount: 2500, currency: "usd", payment_intent: "pi_1" } }
})

function reset(overrides: Partial<typeof db> = {}) {
  db.giftCardForOrder = CARD_ID
  db.classifierFails = false
  db.rpcCalls = []
  db.ordinaryRevokes = 0
  db.refundRows = []
  db.reviews = []
  Object.assign(db, overrides)
}

const called = (fn: string) => db.rpcCalls.filter((c) => c.fn === fn)

// ===========================================================================
// THE GUARD
// ===========================================================================

test("a gift-card refund NEVER reaches ordinary revocation", async () => {
  reset()
  const response = await POST(await signed(refundEvent()))

  assert.equal(response.status, 200)
  assert.equal(db.ordinaryRevokes, 0, "revoke_order must not run for a gift card")
  assert.equal(called("complete_gift_card_refund").length, 1, "the gift-card path ran instead")
})

test("a gift-card DISPUTE never reaches ordinary revocation", async () => {
  reset()
  await POST(await signed(disputeCreated()))

  assert.equal(db.ordinaryRevokes, 0)
  assert.equal(called("record_gift_card_dispute").length, 1)
})

test("an ORDINARY order still takes the ordinary path", async () => {
  reset({ giftCardForOrder: null })
  await POST(await signed(refundEvent()))

  assert.equal(called("record_gift_card_dispute").length, 0)
  assert.equal(called("complete_gift_card_refund").length, 0)
  assert.ok(db.ordinaryRevokes > 0, "a non-gift-card order must still be revoked normally")
})

test("an UNAVAILABLE classifier FAILS CLOSED — ordinary revocation does not run", async () => {
  // If we cannot tell whether this is a gift card, running the ordinary path is
  // the unsafe direction: it would refund the money and leave credit spendable.
  reset({ classifierFails: true })
  const response = await POST(await signed(refundEvent()))

  assert.equal(response.status, 500, "Stripe should redeliver rather than us guessing")
  assert.equal(db.ordinaryRevokes, 0, "NOTHING ordinary ran on an unknown classification")
})

// ===========================================================================
// Refund routing
// ===========================================================================

test("the refund event finalises with the provider's amount, not the face value", async () => {
  reset()
  await POST(await signed(refundEvent(2500)))

  const complete = called("complete_gift_card_refund")[0]
  assert.equal(complete.args.p_refunded_cents, 2500)
  assert.match(String(complete.args.p_provider_refund_id), /^re_/)
})

test("a Dashboard-initiated refund starts the workflow, applying the same rules", async () => {
  // No local request exists, so eligibility must still be evaluated — which is
  // what invalidates the credential and freezes claimed value.
  reset()
  await POST(await signed(refundEvent()))
  assert.equal(called("begin_gift_card_refund").length, 1, "eligibility was evaluated")
})

test("a review_required card is NOT auto-finalised by a refund event", async () => {
  reset()
  db.refundRows = [{ id: "refund-9", state: "review_required", eligible_external_cents: 0 }]
  await POST(await signed(refundEvent()))

  assert.equal(called("complete_gift_card_refund").length, 0, "a human owns it; nothing is reversed")
  assert.equal(db.ordinaryRevokes, 0)
})

// ===========================================================================
// Dispute routing
// ===========================================================================

test("dispute CREATED freezes and links downstream, without revoking anything", async () => {
  reset()
  await POST(await signed(disputeCreated()))

  const dispute = called("record_gift_card_dispute")[0]
  assert.equal(dispute.args.p_gift_card_id, CARD_ID)
  assert.equal(dispute.args.p_disputed_cents, 2500)
  assert.equal(db.ordinaryRevokes, 0, "NO downstream product is revoked")
})

test("dispute WON routes an authoritative win", async () => {
  reset()
  await POST(await signed(disputeClosed("won")))

  const resolved = called("resolve_gift_card_dispute")[0]
  assert.ok(resolved, "the closure reached the gift-card handler")
  assert.equal(resolved.args.p_outcome, "won")
  assert.equal(db.ordinaryRevokes, 0)
})

test("dispute LOST does not unfreeze and does not revoke", async () => {
  reset()
  await POST(await signed(disputeClosed("lost")))

  assert.equal(called("resolve_gift_card_dispute")[0].args.p_outcome, "lost")
  assert.equal(db.ordinaryRevokes, 0, "a lost dispute must not revoke downstream products")
})

test("an UNRECOGNISED closure status is normalised to unknown, never guessed", async () => {
  reset()
  await POST(await signed(disputeClosed("something_new")))

  assert.equal(
    called("resolve_gift_card_dispute")[0].args.p_outcome,
    "unknown",
    "an unknown status must not be treated as a win"
  )
})

// ===========================================================================
// Authentication and replay
// ===========================================================================

test("an UNSIGNED refund event is rejected and touches nothing", async () => {
  reset()
  const response = await POST(
    new Request("https://realfiction.live/api/webhooks/stripe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(refundEvent())
    })
  )

  assert.equal(response.status, 401)
  assert.deepEqual(db.rpcCalls, [], "no classification, no refund, no dispute")
})

test("a BADLY signed event is rejected", async () => {
  reset()
  const payload = JSON.stringify(refundEvent())
  const response = await POST(
    new Request("https://realfiction.live/api/webhooks/stripe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`
      },
      body: payload
    })
  )

  assert.equal(response.status, 401)
  assert.deepEqual(db.rpcCalls, [])
})

test("a test-mode event in live production does nothing", async () => {
  reset()
  const response = await POST(await signed({ ...refundEvent(), livemode: false }))

  assert.equal(response.status, 202)
  assert.deepEqual(db.rpcCalls, [])
})

test("the response leaks no recipient state to the purchaser", async () => {
  reset()
  const response = await POST(await signed(refundEvent()))
  const text = await response.text()

  assert.ok(!/balance|remaining|spent|recipient|downstream/i.test(text))
  assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
})
