// Fail-closed proof for the checkout route.
//
// Loads the REAL route handler with its data layer and Stripe transport mocked,
// then makes the attempt-claim guard throw. The assertion is not just "503" —
// it is that no order was created, no Stripe call was made, and no store credit
// was reserved. Duplicate-payment protection must never silently degrade.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

// Teach Node the "@/..." alias so the real route module can be imported.
register("./test-alias-hook.mjs", import.meta.url)

// Effects we must prove did NOT happen.
const calls = {
  createPendingOrder: 0,
  reserveStoreCredit: 0,
  stripeFetch: 0,
  attachAttempt: 0,
  completeStoreCredit: 0,
  enqueueConfirmation: 0
}

let claimShouldThrow = true
let freeLines = false
let creditBalanceCents = 0
let creditCompletionOk = true
let claimResult: Record<string, unknown> = {
  claimId: "claim-1",
  existingOrderId: null,
  storedFingerprint: null,
  status: "new",
  attemptExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  sessionId: null,
  sessionUrl: null,
  sessionExpiresAt: null
}

class FakeGuardError extends Error {
  readonly guard: string
  constructor(guard: string) {
    super(`Checkout guard unavailable: ${guard}`)
    this.name = "CheckoutGuardUnavailableError"
    this.guard = guard
  }
}

// `server-only` throws by design when loaded outside a Server Component. The
// route legitimately depends on it; stub it so the handler can be exercised.
mock.module("server-only", { namedExports: {}, defaultExport: {} })

mock.module("@/lib/store-server", {
  namedExports: {
    CheckoutGuardUnavailableError: FakeGuardError,
    claimCheckoutAttempt: async () => {
      if (claimShouldThrow) {
        throw new FakeGuardError("claim_checkout_attempt")
      }
      return claimResult
    },
    closeCheckoutAttempt: async () => {},
    attachCheckoutSession: async () => true,
    countRecentCheckoutAttempts: async () => 0,
    attachCheckoutAttemptOrder: async () => {
      calls.attachAttempt++
    },
    createPendingOrder: async () => {
      calls.createPendingOrder++
      return "order-should-not-exist"
    },
    reserveStoreCredit: async () => {
      calls.reserveStoreCredit++
      return true
    },
    resolveCheckoutLines: async () => [
      {
        product: freeLines
          ? {
              id: "p0",
              slug: "free-thing",
              category: "supporter",
              name: "Free",
              description: "d",
              price_cents: 0,
              currency: "USD",
              fulfillment_type: "subscription",
              duration_days: 30,
              metadata: {},
              active: true
            }
          : {
          id: "p1",
          slug: "realvip-1m",
          category: "supporter",
          name: "RealVIP 1 Month",
          description: "d",
          price_cents: 499,
          currency: "USD",
          fulfillment_type: "subscription",
              duration_days: 30,
              metadata: {},
              active: true
            },
        quantity: 1,
        lineTotalCents: freeLines ? 0 : 499
      }
    ],
    getStoreCreditBalanceCents: async () => creditBalanceCents,
    getVerifiedMinecraftLink: async () => ({
      username: "Tester",
      uuid: "00000000-0000-4000-8000-0000000000aa"
    }),
    getOrderStatus: async () => null,
    attachProviderSession: async () => {},
    cancelOrder: async () => {},
    completeStoreCreditOnlyOrder: async () => {
      calls.completeStoreCredit++
      return creditCompletionOk
    },
    releaseStoreCredit: async () => {}
  }
})

mock.module("@/lib/email-delivery", {
  namedExports: {
    enqueueOrderConfirmation: async () => {
      calls.enqueueConfirmation++
      return "queued"
    },
    enqueueRefundConfirmation: async () => "queued",
    storeStripePaymentRefs: async () => {}
  }
})

mock.module("@/lib/supabase/server", {
  namedExports: {
    getAuthenticatedUser: async () => ({
      id: "user-1",
      email: "t@example.test",
      // Checkout now requires a verified address before any order exists.
      email_confirmed_at: "2026-01-01T00:00:00Z"
    })
  }
})

// Any Stripe traffic would go through global fetch; count and fail loudly.
globalThis.fetch = (async (input: unknown) => {
  if (String(input).includes("api.stripe.com")) {
    calls.stripeFetch++
  }
  throw new Error("no network in tests")
}) as typeof fetch

process.env.PAYPAL_ENVIRONMENT = "sandbox"
// isStripeConfigured() only checks presence, so this deliberately does NOT use a
// `sk_test_`/`sk_live_` shape — nothing here should ever trip a secret scanner.
process.env.STRIPE_SECRET_KEY = "not-a-key-tests-never-reach-stripe"

const { POST } = await import("../app/api/store/checkout/route.ts")

function checkoutRequest(body: Record<string, unknown>) {
  return new Request("https://realfiction.live/api/store/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
}

const VALID_BODY = {
  provider: "stripe",
  checkoutAttemptId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  isGift: false,
  applyStoreCredit: false,
  items: [{ productId: "realvip-1m", quantity: 1 }]
}

test("guard failure fails CLOSED: 503, no order, no Stripe call, no credit reserved", async () => {
  claimShouldThrow = true
  calls.createPendingOrder = 0
  calls.reserveStoreCredit = 0
  calls.stripeFetch = 0

  const response = await POST(checkoutRequest(VALID_BODY))

  assert.equal(response.status, 503, "must return 503 on guard failure")
  assert.equal(response.headers.get("Retry-After"), "30")

  const body = (await response.json()) as { error?: string }
  assert.match(body.error ?? "", /temporarily unavailable/i)
  // The safe error must not leak internals.
  assert.doesNotMatch(body.error ?? "", /claim_checkout_attempt|supabase|postgres/i)

  assert.equal(calls.createPendingOrder, 0, "zero internal orders created")
  assert.equal(calls.stripeFetch, 0, "zero Stripe calls")
  assert.equal(calls.reserveStoreCredit, 0, "zero store-credit reservations")
})

test("a missing checkoutAttemptId is rejected before any work", async () => {
  calls.createPendingOrder = 0
  calls.stripeFetch = 0

  const { checkoutAttemptId, ...withoutAttempt } = VALID_BODY
  void checkoutAttemptId
  const response = await POST(checkoutRequest(withoutAttempt))

  assert.equal(response.status, 400)
  assert.equal(calls.createPendingOrder, 0)
  assert.equal(calls.stripeFetch, 0)
})

test("a non-UUID checkoutAttemptId is rejected before any work", async () => {
  calls.createPendingOrder = 0
  calls.stripeFetch = 0

  const response = await POST(checkoutRequest({ ...VALID_BODY, checkoutAttemptId: "1; drop table orders" }))

  assert.equal(response.status, 400)
  assert.equal(calls.createPendingOrder, 0)
  assert.equal(calls.stripeFetch, 0)
})

test("provider=paypal is refused server-side with no order and no provider call", async () => {
  claimShouldThrow = false
  calls.createPendingOrder = 0
  calls.stripeFetch = 0

  const response = await POST(checkoutRequest({ ...VALID_BODY, provider: "paypal" }))

  assert.equal(response.status, 400)
  assert.equal(calls.createPendingOrder, 0, "PayPal must not create an order")
  assert.equal(calls.stripeFetch, 0)
})

// -- Stripe idempotency-key retention edge (route level) ---------------------

const ACTIVE = () => new Date(Date.now() + 3_600_000).toISOString()
const EXPIRED = () => new Date(Date.now() - 60_000).toISOString()
const LONG_EXPIRED = () => new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()

test("retry inside the window reuses the stored Session and calls Stripe zero times", async () => {
  claimShouldThrow = false
  calls.createPendingOrder = 0
  calls.stripeFetch = 0
  claimResult = {
    claimId: "claim-1",
    existingOrderId: "order-1",
    storedFingerprint: null,
    status: "resumed",
    attemptExpiresAt: ACTIVE(),
    sessionId: "cs_live_ORIGINAL",
    sessionUrl: "https://checkout.stripe.com/original",
    sessionExpiresAt: ACTIVE()
  }

  const response = await POST(checkoutRequest(VALID_BODY))
  const body = (await response.json()) as { checkoutUrl?: string; reused?: boolean }

  assert.equal(response.status, 200)
  assert.equal(body.checkoutUrl, "https://checkout.stripe.com/original", "same Session, not a new one")
  assert.equal(body.reused, true)
  assert.equal(calls.stripeFetch, 0, "no Stripe call needed to resume")
  assert.equal(calls.createPendingOrder, 0, "no second order")
})

test("retry AFTER the attempt expired calls Stripe zero times and returns 409", async () => {
  claimShouldThrow = false
  calls.createPendingOrder = 0
  calls.stripeFetch = 0
  claimResult = {
    claimId: "claim-1",
    existingOrderId: "order-1",
    storedFingerprint: null,
    status: "resumed",
    attemptExpiresAt: EXPIRED(),
    sessionId: "cs_live_ORIGINAL",
    sessionUrl: "https://checkout.stripe.com/original",
    sessionExpiresAt: EXPIRED()
  }

  const response = await POST(checkoutRequest(VALID_BODY))
  const body = (await response.json()) as { code?: string }

  assert.equal(response.status, 409)
  assert.equal(body.code, "checkout_attempt_expired")
  assert.equal(calls.stripeFetch, 0, "must NOT call Stripe with a possibly-pruned key")
  assert.equal(calls.createPendingOrder, 0)
})

test("retry after MORE than 24h calls Stripe zero times for the old attempt", async () => {
  claimShouldThrow = false
  calls.stripeFetch = 0
  claimResult = {
    claimId: "claim-1",
    existingOrderId: "order-1",
    storedFingerprint: null,
    status: "resumed",
    attemptExpiresAt: LONG_EXPIRED(),
    sessionId: "cs_live_ANCIENT",
    sessionUrl: "https://checkout.stripe.com/ancient",
    sessionExpiresAt: LONG_EXPIRED()
  }

  const response = await POST(checkoutRequest(VALID_BODY))

  assert.equal(response.status, 409)
  assert.equal(calls.stripeFetch, 0, "a pruned idempotency key is never reused")
})

test("a closed attempt cannot be revived and calls Stripe zero times", async () => {
  claimShouldThrow = false
  calls.stripeFetch = 0
  claimResult = {
    claimId: "claim-1",
    existingOrderId: "order-1",
    storedFingerprint: null,
    status: "closed",
    attemptExpiresAt: ACTIVE(),
    sessionId: null,
    sessionUrl: null,
    sessionExpiresAt: null
  }

  const response = await POST(checkoutRequest(VALID_BODY))
  assert.equal(response.status, 409)
  assert.equal(calls.stripeFetch, 0)
})

test("two tabs: a second attempt reuses the first tab's live Session", async () => {
  claimShouldThrow = false
  calls.createPendingOrder = 0
  calls.stripeFetch = 0
  claimResult = {
    claimId: "claim-other",
    existingOrderId: "order-first-tab",
    storedFingerprint: null,
    status: "active_elsewhere",
    attemptExpiresAt: ACTIVE(),
    sessionId: "cs_live_FIRSTTAB",
    sessionUrl: "https://checkout.stripe.com/firsttab",
    sessionExpiresAt: ACTIVE()
  }

  const response = await POST(checkoutRequest({ ...VALID_BODY, checkoutAttemptId: "9f8e7d6c-5b4a-4938-a271-0e02b2c3d479" }))
  const body = (await response.json()) as { checkoutUrl?: string; reused?: boolean }

  assert.equal(response.status, 200)
  assert.equal(body.checkoutUrl, "https://checkout.stripe.com/firsttab", "second tab gets the FIRST tab's session")
  assert.equal(body.reused, true)
  assert.equal(calls.createPendingOrder, 0, "no second order")
  assert.equal(calls.stripeFetch, 0, "no second Stripe Session")
})

test("two tabs with no reusable session get a clear 409, never a second Session", async () => {
  claimShouldThrow = false
  calls.createPendingOrder = 0
  calls.stripeFetch = 0
  claimResult = {
    claimId: "claim-other",
    existingOrderId: "order-first-tab",
    storedFingerprint: null,
    status: "active_elsewhere",
    attemptExpiresAt: ACTIVE(),
    sessionId: null,
    sessionUrl: null,
    sessionExpiresAt: null
  }

  const response = await POST(checkoutRequest({ ...VALID_BODY, checkoutAttemptId: "9f8e7d6c-5b4a-4938-a271-0e02b2c3d479" }))
  const body = (await response.json()) as { code?: string }

  assert.equal(response.status, 409)
  assert.equal(body.code, "checkout_already_in_progress")
  assert.equal(calls.createPendingOrder, 0)
  assert.equal(calls.stripeFetch, 0)
})

// -- Empty / zero-value cart --------------------------------------------------

test("a zero-value cart creates no order and no Stripe Session", async () => {
  claimShouldThrow = false
  calls.createPendingOrder = 0
  calls.stripeFetch = 0

  // resolveCheckoutLines is mocked to return a free line for this case.
  freeLines = true
  const response = await POST(checkoutRequest(VALID_BODY))
  freeLines = false

  assert.equal(response.status, 400)
  assert.equal(calls.createPendingOrder, 0, "no order for a zero-value cart")
  assert.equal(calls.stripeFetch, 0, "no Stripe Session for a zero-value cart")
})

test("an empty items array is rejected by the schema before any work", async () => {
  calls.createPendingOrder = 0
  calls.stripeFetch = 0

  const response = await POST(checkoutRequest({ ...VALID_BODY, items: [] }))

  assert.equal(response.status, 400)
  assert.equal(calls.createPendingOrder, 0)
  assert.equal(calls.stripeFetch, 0)
})

// -- Store credit vs an actually-empty cart ----------------------------------
//
// The zero-value guard must key on the MERCHANDISE subtotal, not the post-credit
// amount. A $12.99 cart fully covered by credit is a real purchase; a $0 cart is
// not, and the two must never be conflated.

function reset() {
  claimShouldThrow = false
  // Earlier tests mutate the shared claim result to exercise attempt states;
  // restore a fresh attempt so these start from a clean checkout.
  claimResult = {
    claimId: "claim-1",
    existingOrderId: null,
    storedFingerprint: null,
    status: "new",
    attemptExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    sessionId: null,
    sessionUrl: null,
    sessionExpiresAt: null
  }
  freeLines = false
  creditBalanceCents = 0
  creditCompletionOk = true
  calls.createPendingOrder = 0
  calls.reserveStoreCredit = 0
  calls.stripeFetch = 0
  calls.completeStoreCredit = 0
  calls.enqueueConfirmation = 0
}

test("a PARTIALLY credit-funded cart still creates one Stripe Session", async () => {
  reset()
  creditBalanceCents = 500 // covers part of the 499? no — cart is 499, so use less
  creditBalanceCents = 200

  const response = await POST(checkoutRequest({ ...VALID_BODY, applyStoreCredit: true }))

  assert.equal(calls.createPendingOrder, 1)
  assert.equal(calls.reserveStoreCredit, 1, "the applied credit is reserved")
  assert.equal(calls.completeStoreCredit, 0, "not a credit-only order")
  // The Stripe call is attempted (the stub throws, which the route reports as
  // a 500/502) — what matters is that exactly one Session was attempted.
  assert.equal(calls.stripeFetch, 1, "exactly one Stripe Session for the remainder")
  void response
})

test("a FULLY credit-funded valid cart creates zero Stripe Sessions and fulfils once", async () => {
  reset()
  creditBalanceCents = 10_000 // more than the 499 cart

  const response = await POST(checkoutRequest({ ...VALID_BODY, applyStoreCredit: true }))
  const body = (await response.json()) as { completed?: boolean; orderId?: string }

  assert.equal(response.status, 200)
  assert.equal(body.completed, true)
  assert.equal(calls.stripeFetch, 0, "ZERO Stripe API calls for a credit-only order")
  assert.equal(calls.completeStoreCredit, 1, "credit consumed exactly once")
  assert.equal(calls.reserveStoreCredit, 0, "no separate reservation — it is consumed atomically")
})

test("the credit path does NOT enqueue separately — the outbox row is transactional", async () => {
  reset()
  creditBalanceCents = 10_000

  await POST(checkoutRequest({ ...VALID_BODY, applyStoreCredit: true }))

  // complete_store_credit_only_order writes the outbox row in the SAME
  // transaction as the credit spend and fulfilment. A separate best-effort
  // enqueue here would be exactly the durability hole we removed: if it failed
  // after fulfilment committed, the confirmation would be lost with nothing to
  // retry from. (Atomicity is proven in email_outbox_atomicity.test.sql.)
  assert.equal(calls.completeStoreCredit, 1, "one atomic fulfilment call")
  assert.equal(calls.enqueueConfirmation, 0, "no separate, losable enqueue")
  assert.equal(calls.stripeFetch, 0, "and no Stripe receipt promised")
})

test("insufficient credit can never produce a free order", async () => {
  reset()
  creditBalanceCents = 100 // far below the 499 cart

  const response = await POST(checkoutRequest({ ...VALID_BODY, applyStoreCredit: true }))

  // Not credit-only: a balance remains, so it must go to Stripe, never complete free.
  assert.equal(calls.completeStoreCredit, 0)
  assert.equal(calls.stripeFetch, 1, "the remainder is charged")
  void response
})

test("a failure consuming credit fails closed with no fulfilment", async () => {
  reset()
  creditBalanceCents = 10_000
  creditCompletionOk = false

  const response = await POST(checkoutRequest({ ...VALID_BODY, applyStoreCredit: true }))

  assert.equal(response.status, 409)
  assert.equal(calls.enqueueConfirmation, 0, "no confirmation for an unfulfilled order")
  assert.equal(calls.stripeFetch, 0)
})

test("a zero-value cart is rejected even when the buyer has credit", async () => {
  reset()
  creditBalanceCents = 10_000
  freeLines = true

  const response = await POST(checkoutRequest({ ...VALID_BODY, applyStoreCredit: true }))
  freeLines = false

  assert.equal(response.status, 400, "a $0 cart is not a purchase")
  assert.equal(calls.createPendingOrder, 0)
  assert.equal(calls.completeStoreCredit, 0)
  assert.equal(calls.stripeFetch, 0)
})
