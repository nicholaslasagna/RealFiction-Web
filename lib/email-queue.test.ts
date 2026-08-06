import assert from "node:assert/strict"
import test from "node:test"

import {
  backoffSeconds,
  classifyProviderStatus,
  diagnosticCategory,
  EMAIL_MAX_ATTEMPTS,
  isValidStripeReceiptUrl,
  orderConfirmationKey,
  parseRetryAfter,
  refundConfirmationKey,
  sanitizeReceiptUrl
} from "./email/queue.ts"

test("429 and 5xx retry; ordinary 4xx is permanent", () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(classifyProviderStatus(status), "retry", `${status} should retry`)
  }
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(classifyProviderStatus(status), "permanent", `${status} should not retry`)
  }
})

test("diagnostic categories are short, safe labels", () => {
  assert.equal(diagnosticCategory(429), "rate_limited")
  assert.equal(diagnosticCategory(503), "provider_error")
  assert.equal(diagnosticCategory(401), "auth_rejected")
  assert.equal(diagnosticCategory(422), "payload_rejected")
  assert.equal(diagnosticCategory(null), "transport_error")
})

test("Retry-After is honoured in seconds and HTTP-date form", () => {
  assert.equal(parseRetryAfter("120"), 120)
  const now = Date.parse("2026-07-19T12:00:00Z")
  assert.equal(parseRetryAfter("Sun, 19 Jul 2026 12:01:00 GMT", now), 60)
})

test("a malformed or absurd Retry-After is ignored rather than trusted", () => {
  assert.equal(parseRetryAfter(null), null)
  assert.equal(parseRetryAfter("soon"), null)
  assert.equal(parseRetryAfter("0"), null)
  assert.equal(parseRetryAfter("999999"), null, "beyond a day is not credible")
})

test("backoff grows exponentially, is jittered, and is capped", () => {
  assert.ok(backoffSeconds(1, () => 0.5) >= 15)
  assert.ok(backoffSeconds(4, () => 0.5) > backoffSeconds(2, () => 0.5))
  assert.ok(backoffSeconds(20, () => 1) <= 3600 * 1.25 + 1, "capped at roughly an hour")
  // Jitter must actually vary the delay so retries do not synchronise.
  assert.notEqual(backoffSeconds(5, () => 0), backoffSeconds(5, () => 1))
})

test("attempts are capped", () => {
  assert.equal(EMAIL_MAX_ATTEMPTS, 8)
})

test("only HTTPS Stripe-hosted receipt URLs are rendered into emails", () => {
  assert.equal(isValidStripeReceiptUrl("https://pay.stripe.com/receipts/abc"), true)
  assert.equal(isValidStripeReceiptUrl("https://invoice.stripe.com/i/abc"), true)
  assert.equal(isValidStripeReceiptUrl("https://files.stripe.com/x"), true)

  assert.equal(isValidStripeReceiptUrl("http://pay.stripe.com/receipts/abc"), false, "must be HTTPS")
  assert.equal(isValidStripeReceiptUrl("https://evil.test/receipts/abc"), false)
  assert.equal(isValidStripeReceiptUrl("https://stripe.com.evil.test/x"), false, "suffix spoofing")
  assert.equal(isValidStripeReceiptUrl("javascript:alert(1)"), false)
  assert.equal(isValidStripeReceiptUrl(null), false)
  assert.equal(isValidStripeReceiptUrl("not a url"), false)
})

test("sanitize drops anything unsafe instead of rendering it", () => {
  assert.equal(sanitizeReceiptUrl("https://pay.stripe.com/receipts/abc"), "https://pay.stripe.com/receipts/abc")
  assert.equal(sanitizeReceiptUrl("https://evil.test/x"), null)
})

test("delivery identities dedupe on the right entity", () => {
  assert.equal(orderConfirmationKey("order-1"), "order_confirmation:order-1")
  // Keyed on the REFUND, so refund.created and refund.updated collapse to one.
  assert.equal(refundConfirmationKey("re_123"), "refund_confirmation:re_123")
  assert.notEqual(refundConfirmationKey("re_123"), refundConfirmationKey("re_456"))
})
