// The gift-card checkout HTTP route, executed.
//
// The previous pass built the policy, the Stripe builder, and the feature gate
// as modules and called the slice "end to end" without an endpoint wiring them
// together. This file drives the actual route handler: real request objects,
// real branching, real cleanup, mocked externals only.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

const ATTEMPT = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
const ORDER_ID = "11111111-2222-4333-8444-555555555555"

/** Test-only key material. Obviously fake, never a real key. */
const ENV = {
  STORE_GIFT_CARDS_ENABLED: "true",
  GIFT_CARD_CLAIM_PEPPER: "a".repeat(64),
  GIFT_CARD_ENCRYPTION_KEY: "0".repeat(64),
  GIFT_CARD_ENCRYPTION_KEY_VERSION: "1",
  RESEND_API_KEY: "resend-value",
  EMAIL_FROM: "RealFiction <orders@realfiction.live>",
  // Explicit test-only reviewed value. Production has NO default: the tax
  // treatment of stored value at sale is an unresolved Dashboard decision, and
  // the gate fails closed without it.
  GIFT_CARD_TAX_TREATMENT_REVIEWED: "no_tax_at_sale",
  STRIPE_SECRET_KEY: "stripe-secret-value",
  // The abuse controls are mandatory; checkout 503s without this.
  ABUSE_SUBJECT_PEPPER: "test-pepper-not-a-secret",
  NEXT_PUBLIC_SITE_URL: "https://realfiction.live"
}

const state = {
  user: null as { id: string; email: string; email_confirmed_at: string | null } | null,
  orders: [] as string[],
  cancelled: [] as string[],
  closedAttempts: [] as string[],
  attachedSessions: [] as string[],
  orderSessions: [] as { orderId: string; sessionId: string | null }[],
  metadata: {} as Record<string, unknown>,
  stripeBodies: [] as string[],
  stripeOk: true,
  productActive: true,
  productPriceCents: 2500
}

mock.module("server-only", { namedExports: {}, defaultExport: {} })

mock.module("@/lib/supabase/server", {
  namedExports: { getAuthenticatedUser: async () => state.user }
})

mock.module("@/lib/supabase/service-role", {
  namedExports: {
    getSupabaseServiceRoleClient: () => ({
      // The velocity counters. This suite is about checkout branching, so they
      // answer "allow" — the controls have their own suite. What matters here
      // is that they answer AT ALL: an absent `rpc` is indistinguishable from
      // a broken database, and checkout now correctly refuses in that state.
      rpc: async (fn: string) =>
        fn === "evaluate_gift_card_velocity"
          ? { data: [{ decision: "allow", rule: null }], error: null }
          : { data: null, error: null },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { metadata: {} } }) }) }),
        update: (values: Record<string, unknown>) => ({
          eq: async () => {
            state.metadata = (values.metadata as Record<string, unknown>) ?? {}
            return { error: null }
          }
        })
      })
    })
  }
})

mock.module("@/lib/store-server", {
  namedExports: {
    CheckoutGuardUnavailableError: class extends Error {
      guard = "test"
    },
    resolveCheckoutLines: async (input: { items: { productId: string; quantity: number }[] }) => {
      if (!state.productActive) {
        throw new Error("Unknown or inactive product.")
      }
      const slug = input.items[0].productId
      return [
        {
          product: {
            id: "product-uuid",
            slug,
            category: "gift_cards",
            name: "RealFiction Gift Card",
            description: "",
            price_cents: state.productPriceCents,
            currency: "USD",
            fulfillment_type: "consumable",
            duration_days: null,
            metadata: {},
            active: true
          },
          quantity: input.items[0].quantity,
          lineTotalCents: state.productPriceCents
        }
      ]
    },
    claimCheckoutAttempt: async () => ({
      claimId: "claim-1",
      existingOrderId: null,
      storedFingerprint: null,
      status: "new",
      attemptExpiresAt: null,
      sessionId: null,
      sessionUrl: null,
      sessionExpiresAt: null
    }),
    createPendingOrder: async () => {
      state.orders.push(ORDER_ID)
      return ORDER_ID
    },
    attachCheckoutAttemptOrder: async () => {},
    attachCheckoutSession: async (input: { sessionId: string }) => {
      state.attachedSessions.push(input.sessionId)
      return true
    },
    // Reconciliation selects only orders carrying a session id, so the route
    // persists it on the order as well as the attempt.
    attachProviderSession: async (orderId: string, sessionId: string | null) => {
      state.orderSessions.push({ orderId, sessionId })
    },
    closeCheckoutAttempt: async (claimId: string) => {
      state.closedAttempts.push(claimId)
    },
    cancelOrder: async (orderId: string) => {
      state.cancelled.push(orderId)
    }
  }
})

Object.assign(process.env, ENV)

globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  if (String(url).includes("api.stripe.com")) {
    state.stripeBodies.push(String(init?.body))
    if (!state.stripeOk) {
      return { ok: false, status: 402, json: async () => ({ error: { type: "card_error", code: "declined" } }) }
    }
    return {
      ok: true,
      json: async () => ({ id: "cs_gift_1", url: "https://checkout.stripe.com/x", expires_at: 1 })
    }
  }
  throw new Error("unexpected network call")
}) as never as typeof fetch

const { POST } = await import("../app/api/store/gift-cards/checkout/route.ts")

function reset(overrides: Partial<typeof state> = {}) {
  state.user = { id: "user-1", email: "buyer@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" }
  state.orders = []
  state.cancelled = []
  state.closedAttempts = []
  state.attachedSessions = []
  state.orderSessions = []
  state.metadata = {}
  state.stripeBodies = []
  state.stripeOk = true
  state.productActive = true
  state.productPriceCents = 2500
  Object.assign(state, overrides)
  Object.assign(process.env, ENV)
}

function post(body: Record<string, unknown>) {
  return POST(
    new Request("https://realfiction.live/api/store/gift-cards/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  )
}

const VALID = {
  slug: "gift-card-25",
  recipientEmail: "friend@example.com",
  senderName: "Nicholas",
  message: "Happy birthday!",
  sendToSelf: false,
  checkoutAttemptId: ATTEMPT
}

// ===========================================================================
// The happy path
// ===========================================================================

test("a valid $25 request returns a Stripe Checkout URL", async () => {
  reset()
  const response = await post(VALID)
  const body = (await response.json()) as { checkoutUrl?: string; orderId?: string }

  assert.equal(response.status, 200)
  assert.equal(body.checkoutUrl, "https://checkout.stripe.com/x")
  assert.equal(body.orderId, ORDER_ID)
  assert.deepEqual(state.attachedSessions, ["cs_gift_1"])
  assert.deepEqual(
    state.orderSessions,
    [{ orderId: ORDER_ID, sessionId: "cs_gift_1" }],
    "the session is persisted on the ORDER too, or reconciliation could never find it"
  )
  assert.deepEqual(state.cancelled, [], "nothing was cleaned up on success")
})

test("the Stripe request charges exactly $25, card-only, bound to the order", async () => {
  reset()
  await post(VALID)
  const encoded = state.stripeBodies[0]

  assert.match(encoded, /line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=2500/)
  assert.match(encoded, /payment_method_types%5B0%5D=card/)
  assert.match(encoded, /client_reference_id=11111111/)
  assert.ok(!encoded.includes("allow_promotion_codes"))
  assert.ok(!encoded.includes("automatic_tax"))
})

test("the recipient, sender, and message are snapshotted on OUR order, not sent to Stripe", async () => {
  reset()
  await post(VALID)

  assert.equal(state.metadata.gift_recipient_email, "friend@example.com")
  assert.equal(state.metadata.gift_sender_name, "Nicholas")
  assert.equal(state.metadata.gift_message, "Happy birthday!")
  assert.equal(state.metadata.order_kind, "gift_card")

  const encoded = decodeURIComponent(state.stripeBodies[0])
  for (const secret of ["friend@example.com", "Happy birthday", "Nicholas"]) {
    assert.ok(!encoded.includes(secret), `Stripe received "${secret}"`)
  }
})

test("send-to-self uses the verified session address", async () => {
  reset()
  await post({ ...VALID, sendToSelf: true, recipientEmail: "attacker@evil.test" })
  assert.equal(state.metadata.gift_recipient_email, "buyer@example.com")
})

// ===========================================================================
// The gate
// ===========================================================================

test("a DISABLED feature refuses before any state exists", async () => {
  reset()
  process.env.STORE_GIFT_CARDS_ENABLED = "false"

  const response = await post(VALID)
  assert.equal(response.status, 503)
  assert.deepEqual(state.orders, [], "no order was created")
  assert.deepEqual(state.stripeBodies, [], "NO Stripe request was made")
})

test("missing crypto configuration refuses before any state exists", async () => {
  reset()
  process.env.GIFT_CARD_ENCRYPTION_KEY = ""

  const response = await post(VALID)
  assert.equal(response.status, 503)
  assert.deepEqual(state.orders, [])
  assert.deepEqual(state.stripeBodies, [])
})

test("an UNREVIEWED tax treatment refuses before any state exists", async () => {
  // The launch blocker, exercised through the real route.
  reset()
  process.env.GIFT_CARD_TAX_TREATMENT_REVIEWED = ""

  const response = await post(VALID)
  assert.equal(response.status, 503)
  assert.deepEqual(state.orders, [])
  assert.deepEqual(state.stripeBodies, [], "no Stripe request without a reviewed tax decision")
})

test("missing email configuration refuses before any state exists", async () => {
  reset()
  process.env.RESEND_API_KEY = ""

  const response = await post(VALID)
  assert.equal(response.status, 503)
  assert.deepEqual(state.orders, [])
})

test("the gate response never names which key is missing", async () => {
  reset()
  process.env.GIFT_CARD_CLAIM_PEPPER = ""
  const response = await post(VALID)
  const text = JSON.stringify(await response.json())

  for (const leak of ["PEPPER", "ENCRYPTION", "RESEND", "GIFT_CARD_"]) {
    assert.ok(!text.includes(leak), `the response leaked "${leak}"`)
  }
})

// ===========================================================================
// Authentication and input
// ===========================================================================

test("a signed-out request is refused", async () => {
  reset({ user: null })
  const response = await post(VALID)
  assert.equal(response.status, 401)
  assert.deepEqual(state.orders, [])
})

test("an UNVERIFIED buyer is refused", async () => {
  reset()
  state.user = { id: "user-1", email: "buyer@example.com", email_confirmed_at: null }
  const response = await post(VALID)
  assert.equal(response.status, 403)
  assert.deepEqual(state.orders, [])
})

test("ordinary-checkout fields are REJECTED, not silently dropped", async () => {
  for (const forbidden of [
    { applyStoreCredit: true },
    { giftRecipient: "SomePlayer" },
    { items: [{ productId: "realvip-3m", quantity: 1 }] },
    { quantity: 5 },
    { couponCode: "FREE" },
    { provider: "paypal" }
  ]) {
    reset()
    const response = await post({ ...VALID, ...forbidden })
    assert.equal(response.status, 400, `${JSON.stringify(forbidden)} was accepted`)
    assert.deepEqual(state.orders, [], "state was created for a rejected request")
  }
})

test("an unknown denomination is refused before Stripe", async () => {
  reset()
  const response = await post({ ...VALID, slug: "gift-card-7" })
  assert.equal(response.status, 400)
  assert.deepEqual(state.stripeBodies, [])
})

test("an INACTIVE product row is refused even with the feature on", async () => {
  // This is the real production posture today: the flag could be on and the
  // rows are still inactive.
  reset({ productActive: false })
  const response = await post(VALID)
  assert.equal(response.status, 502)
  assert.deepEqual(state.stripeBodies, [], "no Stripe request for an inactive product")
})

test("a PRICE DRIFT between the database and the catalog stops everything", async () => {
  // If the product row says one thing and our denomination table says another,
  // charging either number is a guess.
  reset({ productPriceCents: 2400 })
  const response = await post(VALID)
  assert.equal(response.status, 503)
  assert.deepEqual(state.stripeBodies, [], "no charge on a price disagreement")
})

// ===========================================================================
// Cleanup
// ===========================================================================

test("a Stripe failure CANCELS the order and closes the attempt", async () => {
  reset({ stripeOk: false })
  const response = await post(VALID)

  assert.equal(response.status, 502)
  assert.deepEqual(state.cancelled, [ORDER_ID], "the pending order must not survive")
  assert.deepEqual(state.closedAttempts, ["claim-1"], "the attempt must be closed")
})

test("a failure response never leaks the provider error", async () => {
  reset({ stripeOk: false })
  const response = await post(VALID)
  const text = JSON.stringify(await response.json())

  assert.ok(!text.includes("card_error"))
  assert.ok(!text.includes("declined"))
  assert.match(text, /Nothing has been charged/)
})

test("no claim secret or credential material is created by checkout", async () => {
  // Issuance mints the credential AFTER payment. A card that exists before
  // anyone has paid is value nobody bought.
  reset()
  await post(VALID)
  const everything = JSON.stringify(state)
  for (const pattern of [/verifier/i, /ciphertext/i, /claim_secret/i]) {
    assert.doesNotMatch(everything, pattern)
  }
})
