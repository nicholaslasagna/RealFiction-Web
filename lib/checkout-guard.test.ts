import assert from "node:assert/strict"
import test from "node:test"

import {
  buildCartFingerprint,
  checkAttemptBinding,
  CHECKOUT_ATTEMPT_TTL_SECONDS,
  CHECKOUT_RATE_LIMIT,
  isAttemptActive,
  isSessionReusable,
  STRIPE_SESSION_MAX_TTL_SECONDS,
  STRIPE_SESSION_MIN_TTL_SECONDS,
  stripeSessionExpiresAt,
  evaluateRateLimit,
  isGiftCardProduct,
  isPayPalAllowed,
  isValidCheckoutAttemptId,
  rejectDisabledProducts,
  rejectDisabledProvider
} from "./checkout-guard.ts"

// -- PayPal blocked in production --------------------------------------------

test("paypal is not allowed while PAYPAL_ENVIRONMENT is sandbox", () => {
  assert.equal(isPayPalAllowed({ PAYPAL_ENVIRONMENT: "sandbox" }), false)
  assert.equal(isPayPalAllowed({}), false)
  assert.equal(isPayPalAllowed({ PAYPAL_ENVIRONMENT: "" }), false)
})

test("a direct provider=paypal request is rejected server-side", () => {
  const rejection = rejectDisabledProvider("paypal", { PAYPAL_ENVIRONMENT: "sandbox" })
  assert.ok(rejection)
  assert.equal(rejection?.code, "paypal_disabled")
  assert.equal(rejection?.status, 400)
  // The customer-facing message must not advertise PayPal as coming soon.
  assert.doesNotMatch(rejection?.message ?? "", /paypal/i)
})

test("stripe is never blocked by the paypal gate", () => {
  assert.equal(rejectDisabledProvider("stripe", { PAYPAL_ENVIRONMENT: "sandbox" }), null)
})

test("paypal would be allowed only after an explicit live switch", () => {
  assert.equal(isPayPalAllowed({ PAYPAL_ENVIRONMENT: "live" }), true)
})

// -- Gift cards blocked in production ----------------------------------------

test("gift card products are detected by category and slug", () => {
  assert.equal(isGiftCardProduct({ category: "gift_cards" }), true)
  assert.equal(isGiftCardProduct({ slug: "gift-card-25" }), true)
  assert.equal(isGiftCardProduct({ slug: "gift_card_25" }), true)
  assert.equal(isGiftCardProduct({ slug: "realvip-permanent", category: "supporter" }), false)
})

test("a direct API request cannot buy a gift card in production", () => {
  const rejection = rejectDisabledProducts([{ slug: "realvip-permanent", category: "supporter" }, { slug: "gift-card-25", category: "gift_cards" }], {})
  assert.ok(rejection)
  assert.equal(rejection?.code, "gift_cards_disabled")
})

test("normal products are unaffected by the gift card gate", () => {
  assert.equal(rejectDisabledProducts([{ slug: "realvip-permanent", category: "supporter" }], {}), null)
})

test("gift cards can be re-enabled by explicit config after their audit", () => {
  assert.equal(
    rejectDisabledProducts([{ slug: "gift-card-25", category: "gift_cards" }], { STORE_GIFT_CARDS_ENABLED: "true" }),
    null
  )
})

// -- Checkout attempt identity ----------------------------------------------

const baseCart = {
  userId: "user-1",
  provider: "stripe",
  applyStoreCredit: false,
  isGift: false,
  minecraftUuid: "00000000-0000-4000-8000-0000000000aa",
  items: [{ productId: "realvip-permanent", quantity: 1 }]
}

test("attempt ids must be UUIDs — no client-chosen strings", () => {
  assert.equal(isValidCheckoutAttemptId("f47ac10b-58cc-4372-a567-0e02b2c3d479"), true)
  assert.equal(isValidCheckoutAttemptId("not-a-uuid"), false)
  assert.equal(isValidCheckoutAttemptId(""), false)
  assert.equal(isValidCheckoutAttemptId(undefined), false)
  assert.equal(isValidCheckoutAttemptId("../../etc/passwd"), false)
})

test("the same cart produces a stable fingerprint regardless of item order", () => {
  const a = buildCartFingerprint({
    ...baseCart,
    items: [
      { productId: "realvip-permanent", quantity: 1 },
      { productId: "realpets-permanent", quantity: 1 }
    ]
  })
  const b = buildCartFingerprint({
    ...baseCart,
    items: [
      { productId: "realpets-permanent", quantity: 1 },
      { productId: "realvip-permanent", quantity: 1 }
    ]
  })
  assert.equal(a, b)
})

test("fingerprint changes with cart, account, delivery target, or credit choice", () => {
  const base = buildCartFingerprint(baseCart)
  assert.notEqual(base, buildCartFingerprint({ ...baseCart, userId: "user-2" }))
  assert.notEqual(base, buildCartFingerprint({ ...baseCart, items: [{ productId: "realpets-permanent", quantity: 1 }] }))
  assert.notEqual(base, buildCartFingerprint({ ...baseCart, items: [{ productId: "realvip-permanent", quantity: 2 }] }))
  assert.notEqual(base, buildCartFingerprint({ ...baseCart, applyStoreCredit: true }))
  // Binding to the linked Minecraft UUID: an attempt cannot be re-aimed at a
  // different delivery target.
  assert.notEqual(base, buildCartFingerprint({ ...baseCart, minecraftUuid: "00000000-0000-4000-8000-0000000000bb" }))
})

test("fingerprint is time-independent — the same attempt is valid forever", () => {
  // The whole point of replacing time buckets: elapsed time must never change
  // the identity of an attempt, because that produced two payable sessions.
  const first = buildCartFingerprint(baseCart)
  const laterSameInputs = buildCartFingerprint({ ...baseCart })
  assert.equal(first, laterSameInputs)
})

test("an attempt retried with the SAME cart is accepted", () => {
  const fingerprint = buildCartFingerprint(baseCart)
  assert.deepEqual(checkAttemptBinding(fingerprint, fingerprint), { ok: true })
})

test("an attempt reused with a MODIFIED cart is rejected", () => {
  const original = buildCartFingerprint(baseCart)
  const modified = buildCartFingerprint({ ...baseCart, items: [{ productId: "realpets-permanent", quantity: 1 }] })
  const result = checkAttemptBinding(original, modified)
  assert.equal(result.ok, false)
  assert.equal(result.ok === false ? result.code : null, "attempt_cart_mismatch")
  assert.equal(result.ok === false ? result.status : null, 409)
})

test("an attempt reused against a different account is rejected", () => {
  const original = buildCartFingerprint(baseCart)
  const otherAccount = buildCartFingerprint({ ...baseCart, userId: "attacker" })
  assert.equal(checkAttemptBinding(original, otherAccount).ok, false)
})

test("an attempt reused against a different Minecraft UUID is rejected", () => {
  const original = buildCartFingerprint(baseCart)
  const retargeted = buildCartFingerprint({ ...baseCart, minecraftUuid: "00000000-0000-4000-8000-0000000000cc" })
  assert.equal(checkAttemptBinding(original, retargeted).ok, false)
})

test("a brand new attempt (no stored fingerprint) is accepted", () => {
  assert.deepEqual(checkAttemptBinding(null, buildCartFingerprint(baseCart)), { ok: true })
})

test("a DIFFERENT attempt id can buy the same cart again", () => {
  // Identity lives in the attempt id, not the cart, so re-purchasing to stack
  // time only needs a fresh id — proven end-to-end by the pgTAP attempt tests.
  const fingerprint = buildCartFingerprint(baseCart)
  assert.deepEqual(checkAttemptBinding(null, fingerprint), { ok: true })
  assert.deepEqual(checkAttemptBinding(fingerprint, fingerprint), { ok: true })
})

// -- Rate limiting -----------------------------------------------------------

test("checkout is allowed below the limit", () => {
  assert.deepEqual(evaluateRateLimit(0), { allowed: true, retryAfterSeconds: 0 })
  assert.deepEqual(evaluateRateLimit(CHECKOUT_RATE_LIMIT.maxAttempts - 1), { allowed: true, retryAfterSeconds: 0 })
})

test("checkout is rate limited at the threshold with a retry hint", () => {
  const decision = evaluateRateLimit(CHECKOUT_RATE_LIMIT.maxAttempts)
  assert.equal(decision.allowed, false)
  assert.equal(decision.retryAfterSeconds, CHECKOUT_RATE_LIMIT.windowSeconds)
})

test("rate limit stays closed above the threshold", () => {
  assert.equal(evaluateRateLimit(CHECKOUT_RATE_LIMIT.maxAttempts + 50).allowed, false)
})

// -- Bounded lifetime / Stripe idempotency retention edge --------------------

test("attempt TTL stays well inside Stripe's 24h idempotency-key retention", () => {
  // Stripe may prune an idempotency key once it is ~24h old; after that, reusing
  // the key creates a NEW session instead of replaying the original. The attempt
  // must die long before that.
  assert.ok(CHECKOUT_ATTEMPT_TTL_SECONDS < 24 * 60 * 60)
  assert.ok(CHECKOUT_ATTEMPT_TTL_SECONDS <= STRIPE_SESSION_MAX_TTL_SECONDS)
  assert.ok(CHECKOUT_ATTEMPT_TTL_SECONDS >= STRIPE_SESSION_MIN_TTL_SECONDS)
})

test("Stripe session expires_at is absolute seconds inside Stripe's valid range", () => {
  const now = 1_700_000_000_000
  const expires = stripeSessionExpiresAt(now)
  const deltaSeconds = expires - Math.floor(now / 1000)
  assert.equal(deltaSeconds, CHECKOUT_ATTEMPT_TTL_SECONDS)
  assert.ok(deltaSeconds >= STRIPE_SESSION_MIN_TTL_SECONDS, "at least 30 minutes out")
  assert.ok(deltaSeconds <= STRIPE_SESSION_MAX_TTL_SECONDS, "at most 24 hours out")
})

test("a too-short or too-long TTL is clamped into Stripe's accepted range", () => {
  const now = 1_700_000_000_000
  assert.equal(stripeSessionExpiresAt(now, 60) - Math.floor(now / 1000), STRIPE_SESSION_MIN_TTL_SECONDS)
  assert.equal(
    stripeSessionExpiresAt(now, 99 * 60 * 60) - Math.floor(now / 1000),
    STRIPE_SESSION_MAX_TTL_SECONDS
  )
})

test("an attempt is active only while unclosed AND unexpired", () => {
  const now = Date.now()
  const future = new Date(now + 60_000).toISOString()
  const past = new Date(now - 60_000).toISOString()

  assert.equal(isAttemptActive({ status: "resumed", attemptExpiresAt: future }, now), true)
  assert.equal(isAttemptActive({ status: "resumed", attemptExpiresAt: past }, now), false)
  assert.equal(isAttemptActive({ status: "closed", attemptExpiresAt: future }, now), false)
})

test("unknown expiration state fails CLOSED", () => {
  const now = Date.now()
  assert.equal(isAttemptActive({ status: "resumed", attemptExpiresAt: null }, now), false)
  assert.equal(isAttemptActive({ status: "resumed", attemptExpiresAt: "not-a-date" }, now), false)
  assert.equal(isAttemptActive({}, now), false)
})

test("a session is reusable only while complete and unexpired", () => {
  const now = Date.now()
  const future = new Date(now + 60_000).toISOString()
  const past = new Date(now - 60_000).toISOString()

  assert.equal(isSessionReusable({ id: "cs_1", url: "https://x", expiresAt: future }, now), true)
  // Expired session -> not reusable, so a retry must NOT be sent to Stripe with
  // the old (possibly pruned) idempotency key.
  assert.equal(isSessionReusable({ id: "cs_1", url: "https://x", expiresAt: past }, now), false)
  assert.equal(isSessionReusable({ id: "cs_1", url: null, expiresAt: future }, now), false)
  assert.equal(isSessionReusable({ id: null, url: "https://x", expiresAt: future }, now), false)
  assert.equal(isSessionReusable({ id: "cs_1", url: "https://x", expiresAt: null }, now), false)
})

test("a >24h-old attempt is never reusable, so its pruned key is never reused", () => {
  const now = Date.now()
  const twentyFiveHoursAgo = new Date(now - 25 * 60 * 60 * 1000).toISOString()
  assert.equal(isAttemptActive({ status: "resumed", attemptExpiresAt: twentyFiveHoursAgo }, now), false)
  assert.equal(
    isSessionReusable({ id: "cs_old", url: "https://x", expiresAt: twentyFiveHoursAgo }, now),
    false
  )
})
