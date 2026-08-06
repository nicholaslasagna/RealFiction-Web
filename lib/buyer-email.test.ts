import assert from "node:assert/strict"
import test from "node:test"

import { isValidEmailAddress, normalizeEmail, requireVerifiedBuyerEmail } from "./checkout-guard.ts"

const VERIFIED = { email: "Buyer@Example.TEST", email_confirmed_at: "2026-01-01T00:00:00Z" }

test("a verified address passes and is normalised", () => {
  const result = requireVerifiedBuyerEmail(VERIFIED)
  assert.equal(result.ok, true)
  assert.equal(result.ok === true ? result.email : null, "buyer@example.test")
})

test("the older confirmed_at alias also counts as verified", () => {
  const result = requireVerifiedBuyerEmail({ email: "a@b.test", confirmed_at: "2026-01-01T00:00:00Z" })
  assert.equal(result.ok, true)
})

test("a missing email is refused with 403", () => {
  for (const user of [{}, { email: null }, { email: "   " }]) {
    const result = requireVerifiedBuyerEmail(user)
    assert.equal(result.ok, false)
    assert.equal(result.ok === false ? result.code : null, "email_missing")
    assert.equal(result.ok === false ? result.status : null, 403)
  }
})

test("a malformed email is refused with 403", () => {
  for (const email of ["not-an-email", "a@b", "two@@b.test", "spaces in@b.test", `${"x".repeat(250)}@b.test`]) {
    const result = requireVerifiedBuyerEmail({ email, email_confirmed_at: "2026-01-01T00:00:00Z" })
    assert.equal(result.ok, false, `${email} should be rejected`)
    assert.equal(result.ok === false ? result.code : null, "email_invalid")
  }
})

test("an UNVERIFIED address is refused with 403 and a clear instruction", () => {
  const result = requireVerifiedBuyerEmail({ email: "buyer@example.test", email_confirmed_at: null })
  assert.equal(result.ok, false)
  assert.equal(result.ok === false ? result.code : null, "email_unverified")
  assert.equal(result.ok === false ? result.status : null, 403)
  assert.match(result.ok === false ? result.message : "", /verify your email/i)
})

test("rejection messages never echo the address back", () => {
  const result = requireVerifiedBuyerEmail({ email: "secret.person@example.test" })
  assert.equal(result.ok, false)
  assert.doesNotMatch(result.ok === false ? result.message : "", /secret\.person/)
})

test("normalisation lowercases and trims", () => {
  assert.equal(normalizeEmail("  Buyer@Example.TEST "), "buyer@example.test")
  assert.equal(normalizeEmail(null), "")
})

test("address validity is conservative but accepts real addresses", () => {
  assert.equal(isValidEmailAddress("player+tag@sub.example.co.uk"), true)
  assert.equal(isValidEmailAddress("a@b.test"), true)
  assert.equal(isValidEmailAddress("a@b"), false)
})
