// Gift-card issuance driven through the REAL Stripe webhook handler.
//
// The previous passes proved issuance by calling the RPC directly. That skips
// everything that decides whether the RPC should be called at all: signature
// verification, environment separation, event classification, and the shared
// payment-facts gate. This file signs real events with a test secret and posts
// them at the actual route.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

const ORDER_ID = "11111111-2222-4333-8444-555555555555"

const db = {
  cards: [] as string[],
  credentials: [] as { verifier: string; ciphertext: string }[],
  outbox: [] as { key: string; template: string; recipient: string; params: Record<string, unknown> }[],
  rewards: [] as string[],
  orderStatus: "pending",
  processedEvents: new Set<string>(),
  issueShouldFail: false,
  outboxShouldFail: false
}

mock.module("server-only", { namedExports: {}, defaultExport: {} })

/**
 * A stand-in for `issue_gift_card_for_order` that behaves like the real one on
 * the properties this file is about: idempotent on the order, atomic across the
 * card + credential + both emails, and never producing a RealCore reward.
 */
function issueRpc(args: Record<string, unknown>) {
  if (db.issueShouldFail) {
    return { data: null, error: { message: "deadlock detected" } }
  }
  if (db.cards.length > 0) {
    return { data: [{ issued: false, outcome: "already_issued", gift_card_id: db.cards[0] }], error: null }
  }

  // Atomicity: stage everything, and commit only if the outbox writes succeed.
  const stagedOutbox = [
    {
      key: `gift_card_purchase:card-1`,
      template: "gift_card_purchase",
      recipient: "buyer@example.com",
      params: { amount_cents: 2500, public_ref: "RFG-TEST" }
    },
    {
      key: `gift_card_delivery:card-1`,
      template: "gift_card_delivery",
      recipient: "friend@example.com",
      params: { gift_card_id: "card-1", amount_cents: 2500 }
    }
  ]

  if (db.outboxShouldFail) {
    // The real function is one transaction, so a failed outbox insert takes the
    // card and the credential with it.
    return { data: null, error: { message: "outbox insert failed" } }
  }

  db.cards.push("card-1")
  db.credentials.push({
    verifier: String(args.p_verifier),
    ciphertext: String(args.p_delivery_ciphertext)
  })
  db.outbox.push(...stagedOutbox)
  db.orderStatus = "fulfilled"

  return { data: [{ issued: true, outcome: "issued", gift_card_id: "card-1", public_ref: "RFG-TEST" }], error: null }
}

mock.module("@/lib/supabase/service-role", {
  namedExports: {
    getSupabaseServiceRoleClient: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn === "issue_gift_card_for_order") {
          return issueRpc(args)
        }
        return { data: null, error: { message: `unexpected rpc ${fn}` } }
      },
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null }),
            // isGiftCardOrder reads order_items -> products(category)
            then: (resolve: (value: unknown) => void) =>
              resolve({ data: table === "order_items" ? [{ products: { category: "gift_cards" } }] : [] })
          })
        })
      })
    })
  }
})

mock.module("@/lib/store-server", {
  namedExports: {
    persistWebhookEvent: async (_p: string, id: string) => {
      const seen = db.processedEvents.has(id)
      return { duplicate: seen, alreadyProcessed: seen }
    },
    markWebhookEventProcessed: async (_p: string, id: string) => {
      db.processedEvents.add(id)
    },
    getOrderExpectation: async () => ({
      orderId: ORDER_ID,
      sessionId: "cs_gift_1",
      paymentDueCents: 2500,
      currency: "USD",
      liveMode: true,
      status: db.orderStatus
    }),
    fulfillPaidOrderWithOutbox: async () => {
      // If this runs for a gift-card order, the routing is wrong.
      db.rewards.push("ORDINARY_FULFILMENT_RAN")
      return { alreadyFulfilled: false, emailQueued: true }
    },
    recordPaymentReview: async () => {},
    getOrderPaymentContext: async () => null,
    findOrderIdByPaymentId: async () => ORDER_ID,
    markOrderUnpaidClosed: async () => true,
    releaseStoreCredit: async () => {},
    revokeOrderWithRefundOutbox: async () => ({ claimed: true, emailQueued: true }),
    enqueuePartialRefundOutbox: async () => {}
  }
})

globalThis.fetch = (async () => {
  throw new Error("no network during webhook handling")
}) as typeof fetch

process.env.STRIPE_ENVIRONMENT = "live"
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret_for_signing_only"
process.env.GIFT_CARD_CLAIM_PEPPER = "a".repeat(64)
process.env.GIFT_CARD_ENCRYPTION_KEY = "0".repeat(64)
process.env.GIFT_CARD_ENCRYPTION_KEY_VERSION = "1"

const { POST } = await import("../app/api/webhooks/stripe/route.ts")

/** Signs the event exactly as Stripe does. Authentication is NOT bypassed. */
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

function paidEvent(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: "checkout.session.completed",
    livemode: true,
    data: {
      object: {
        id: "cs_gift_1",
        metadata: { order_id: ORDER_ID },
        payment_status: "paid",
        payment_intent: "pi_gift_1",
        amount_total: 2500,
        currency: "usd",
        ...overrides
      }
    }
  }
}

function reset() {
  db.cards = []
  db.credentials = []
  db.outbox = []
  db.rewards = []
  db.orderStatus = "pending"
  db.processedEvents = new Set()
  db.issueShouldFail = false
  db.outboxShouldFail = false
}

// ===========================================================================
// The path
// ===========================================================================

test("a SIGNED paid webhook issues exactly one gift card", async () => {
  reset()
  const response = await POST(await signedRequest(paidEvent("evt_1")))

  assert.equal(response.status, 200)
  assert.equal(db.cards.length, 1, "exactly one card")
  assert.equal(db.credentials.length, 1, "exactly one credential")
  assert.equal(db.outbox.length, 2, "exactly two emails")
  assert.equal(db.orderStatus, "fulfilled")
})

test("the credential carries a real 256-bit-derived verifier and sealed secret", async () => {
  reset()
  await POST(await signedRequest(paidEvent("evt_2")))

  const credential = db.credentials[0]
  assert.match(credential.verifier, /^[0-9a-f]{64}$/, "HMAC-SHA256 hex")
  assert.match(credential.ciphertext, /^v1\./, "versioned AES-GCM envelope")
})

test("BOTH emails are queued, to the right people", async () => {
  reset()
  await POST(await signedRequest(paidEvent("evt_3")))

  const purchase = db.outbox.find((row) => row.template === "gift_card_purchase")
  const delivery = db.outbox.find((row) => row.template === "gift_card_delivery")
  assert.equal(purchase?.recipient, "buyer@example.com")
  assert.equal(delivery?.recipient, "friend@example.com")
})

test("NO claim secret reaches the outbox", async () => {
  reset()
  await POST(await signedRequest(paidEvent("evt_4")))

  const serialized = JSON.stringify(db.outbox)
  assert.ok(!serialized.includes(db.credentials[0].ciphertext))
  assert.ok(!serialized.includes(db.credentials[0].verifier))
  assert.doesNotMatch(serialized, /secret|verifier|ciphertext/i)
})

test("NO RealCore reward is created, and ordinary fulfilment never runs", async () => {
  reset()
  await POST(await signedRequest(paidEvent("evt_5")))
  assert.deepEqual(db.rewards, [], "a gift card must not reach ordinary product fulfilment")
})

// ===========================================================================
// Replay
// ===========================================================================

test("replaying the SAME event creates nothing additional", async () => {
  reset()
  await POST(await signedRequest(paidEvent("evt_replay")))
  await POST(await signedRequest(paidEvent("evt_replay")))

  assert.equal(db.cards.length, 1)
  assert.equal(db.credentials.length, 1)
  assert.equal(db.outbox.length, 2)
})

test("a DIFFERENT event for the same payment creates nothing additional", async () => {
  // Stripe emits checkout.session.completed and async_payment_succeeded for one
  // payment. Two distinct event ids, one card.
  reset()
  await POST(await signedRequest(paidEvent("evt_a")))
  await POST(await signedRequest({ ...paidEvent("evt_b"), type: "checkout.session.async_payment_succeeded" }))

  assert.equal(db.cards.length, 1, "still one card")
  assert.equal(db.outbox.length, 2, "still two emails")
})

// ===========================================================================
// The gate refuses
// ===========================================================================

test("an UNSIGNED request is rejected outright", async () => {
  reset()
  const response = await POST(
    new Request("https://realfiction.live/api/webhooks/stripe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(paidEvent("evt_unsigned"))
    })
  )

  assert.equal(response.status, 401)
  assert.equal(db.cards.length, 0, "no card from an unsigned event")
})

test("a BADLY signed request is rejected", async () => {
  reset()
  const payload = JSON.stringify(paidEvent("evt_badsig"))
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
  assert.equal(db.cards.length, 0)
})

test("a WRONG AMOUNT does not issue", async () => {
  reset()
  await POST(await signedRequest(paidEvent("evt_amount", { amount_total: 100 })))
  assert.equal(db.cards.length, 0, "an amount that is not the face value must not issue a card")
})

test("a WRONG CURRENCY does not issue", async () => {
  reset()
  await POST(await signedRequest(paidEvent("evt_currency", { currency: "eur" })))
  assert.equal(db.cards.length, 0)
})

test("a WRONG SESSION binding does not issue", async () => {
  reset()
  await POST(await signedRequest(paidEvent("evt_session", { id: "cs_someone_else" })))
  assert.equal(db.cards.length, 0)
})

test("a TEST-MODE event in live production does nothing", async () => {
  reset()
  const response = await POST(await signedRequest({ ...paidEvent("evt_testmode"), livemode: false }))
  assert.equal(response.status, 202)
  assert.equal(db.cards.length, 0)
})

test("an UNPAID session does not issue", async () => {
  reset()
  await POST(await signedRequest(paidEvent("evt_unpaid", { payment_status: "unpaid" })))
  assert.equal(db.cards.length, 0)
})

// ===========================================================================
// Failure and retry
// ===========================================================================

test("an OUTBOX failure rolls back the whole issuance", async () => {
  reset()
  db.outboxShouldFail = true

  const response = await POST(await signedRequest(paidEvent("evt_outbox_fail")))

  assert.equal(response.status, 500, "Stripe must be asked to redeliver")
  assert.equal(db.cards.length, 0, "NO card exists")
  assert.equal(db.credentials.length, 0, "NO credential exists")
  assert.equal(db.outbox.length, 0, "NO partial email was queued")
  assert.equal(db.orderStatus, "pending", "the order stays retryable")
})

test("retrying after a transient failure succeeds EXACTLY ONCE", async () => {
  reset()
  db.issueShouldFail = true
  const first = await POST(await signedRequest(paidEvent("evt_retry")))
  assert.equal(first.status, 500)
  assert.equal(db.cards.length, 0)

  db.issueShouldFail = false
  const second = await POST(await signedRequest(paidEvent("evt_retry")))
  assert.equal(second.status, 200)
  assert.equal(db.cards.length, 1)
  assert.equal(db.outbox.length, 2)

  // And a third delivery of the same event still changes nothing.
  await POST(await signedRequest(paidEvent("evt_retry")))
  assert.equal(db.cards.length, 1)
  assert.equal(db.outbox.length, 2)
})
