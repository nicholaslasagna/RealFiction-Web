// The hostile-hostname proof for the shared test URL helper.
//
// CodeQL flagged eleven `String(url).includes("api.stripe.com")` checks across
// the suite (js/incomplete-url-substring-sanitization). This file is the
// regression test for the replacement: it enumerates the exact strings a
// substring check gets wrong, and asserts none of them matches.
import assert from "node:assert/strict"
import { register } from "node:module"
import { test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

const { isResendRequest, isStripeRequest, requestHost } = await import(
  "../tests/support/request-host.ts"
)

// ===========================================================================
// The real thing matches
// ===========================================================================

test("a genuine Stripe URL matches", () => {
  assert.equal(isStripeRequest("https://api.stripe.com/v1/checkout/sessions"), true)
  assert.equal(isStripeRequest("https://api.stripe.com/v1/refunds"), true)
  assert.equal(isStripeRequest("https://api.stripe.com"), true)
  assert.equal(isStripeRequest("https://api.stripe.com/v1/refunds?x=1#y"), true)
})

test("a genuine Resend URL matches", () => {
  assert.equal(isResendRequest("https://api.resend.com/emails"), true)
})

test("the host comparison is case-insensitive, as hostnames are", () => {
  assert.equal(isStripeRequest("https://API.STRIPE.COM/v1/refunds"), true)
})

// ===========================================================================
// THE FOUR HOSTILE FORMS — the whole point of the fix
// ===========================================================================

test("a path that merely CONTAINS the host does not match", () => {
  // `includes` said yes. This is someone else's server.
  assert.equal(isStripeRequest("https://evil.example/api.stripe.com"), false)
  assert.equal(isStripeRequest("https://evil.example/v1/api.stripe.com/refunds"), false)
})

test("a SUBDOMAIN OF AN ATTACKER'S DOMAIN does not match", () => {
  // `includes` said yes. `startsWith("https://api.stripe.com")` also says yes.
  assert.equal(isStripeRequest("https://api.stripe.com.evil.example/v1/refunds"), false)
})

test("a DIFFERENT HOST THAT ENDS WITH THE NAME does not match", () => {
  // `includes` said yes. `endsWith("api.stripe.com")` also says yes.
  assert.equal(isStripeRequest("https://evil-api.stripe.com/v1/refunds"), false)
})

test("USERINFO cannot smuggle the host past the check", () => {
  // The authority is `api.stripe.com.evil.example`; everything before the @ is
  // a username. This is the classic phishing URL shape.
  assert.equal(isStripeRequest("https://api.stripe.com@evil.example/v1"), false)
  assert.equal(isStripeRequest("https://user:api.stripe.com@evil.example/v1"), false)
})

test("the same four forms are refused for Resend", () => {
  for (const hostile of [
    "https://evil.example/api.resend.com",
    "https://api.resend.com.evil.example/emails",
    "https://evil-api.resend.com/emails",
    "https://api.resend.com@evil.example/emails"
  ]) {
    assert.equal(isResendRequest(hostile), false, hostile)
  }
})

// ===========================================================================
// Neighbouring shapes
// ===========================================================================

test("a SUBDOMAIN of the real domain is not the API host either", () => {
  // Genuinely under stripe.com, but not the endpoint this identifies.
  assert.equal(isStripeRequest("https://evil.api.stripe.com/v1"), false)
  assert.equal(isStripeRequest("https://stripe.com/v1"), false)
})

test("one host never matches the other", () => {
  assert.equal(isStripeRequest("https://api.resend.com/emails"), false)
  assert.equal(isResendRequest("https://api.stripe.com/v1/refunds"), false)
})

test("unparsable and relative values FAIL CLOSED", () => {
  for (const bad of ["", "not a url", "/v1/refunds", "api.stripe.com", null, undefined, 12345, {}]) {
    assert.equal(isStripeRequest(bad), false, String(bad))
    assert.equal(requestHost(bad), null, String(bad))
  }
})

test("requestHost returns the authority, not the string", () => {
  assert.equal(requestHost("https://api.stripe.com/v1/refunds"), "api.stripe.com")
  assert.equal(requestHost("https://api.stripe.com.evil.example/x"), "api.stripe.com.evil.example")
  assert.equal(requestHost("https://api.stripe.com@evil.example/x"), "evil.example")
})

test("a Request object works as well as a string", () => {
  // The stubs receive whatever the caller passed to `fetch`.
  assert.equal(isStripeRequest(new URL("https://api.stripe.com/v1/refunds")), true)
  assert.equal(isStripeRequest(new URL("https://evil-api.stripe.com/v1")), false)
})
