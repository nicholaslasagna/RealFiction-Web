// Pseudonymisation, and the rule about which headers are identity.
import assert from "node:assert/strict"
import { register } from "node:module"
import { test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

const { hashSubject, trustworthyClientIp } = await import("./abuse/subjects.ts")
const { canRequestCashRedemption, cashRedemptionBadge } = await import("./gift-card/customer-state.ts")

const headers = (init: Record<string, string>) => new Headers(init)
const PEPPER = "pepper-for-tests"

// ===========================================================================
// Which address is identity
// ===========================================================================

test("Cloudflare's address is trusted", () => {
  assert.equal(trustworthyClientIp(headers({ "cf-connecting-ip": "203.0.113.4" })), "203.0.113.4")
})

test("X-Forwarded-For is NEVER trusted, even alone", () => {
  // Any client can set it. Trusting it would let an attacker mint unlimited
  // identities, or pin their abuse to a stranger's address.
  assert.equal(trustworthyClientIp(headers({ "x-forwarded-for": "198.51.100.7" })), null)
  assert.equal(
    trustworthyClientIp(headers({ "x-forwarded-for": "198.51.100.7", "x-real-ip": "198.51.100.8" })),
    null
  )
})

test("a list-shaped or oversized CF header is discarded", () => {
  assert.equal(trustworthyClientIp(headers({ "cf-connecting-ip": "1.2.3.4, 5.6.7.8" })), null)
  assert.equal(trustworthyClientIp(headers({ "cf-connecting-ip": "x".repeat(60) })), null)
})

// ===========================================================================
// The hash
// ===========================================================================

test("the same value hashes the same way, and a different one differently", async () => {
  const first = await hashSubject("ip", "203.0.113.4", PEPPER)
  assert.equal(first, await hashSubject("ip", "203.0.113.4", PEPPER))
  assert.notEqual(first, await hashSubject("ip", "203.0.113.5", PEPPER))
  assert.match(String(first), /^[0-9a-f]{64}$/)
})

test("the hash contains NOTHING of the value", async () => {
  const hash = String(await hashSubject("email", "victim@example.com", PEPPER))
  assert.ok(!hash.includes("victim"))
  assert.ok(!hash.includes("example"))
})

test("KINDS ARE DOMAIN-SEPARATED", async () => {
  // Without this, someone who sends a card to their own address collides with
  // themselves across two different rules.
  assert.notEqual(
    await hashSubject("email", "a@e.test", PEPPER),
    await hashSubject("recipient", "a@e.test", PEPPER)
  )
})

test("a different pepper gives a different subject", async () => {
  assert.notEqual(
    await hashSubject("ip", "203.0.113.4", PEPPER),
    await hashSubject("ip", "203.0.113.4", "other-pepper")
  )
})

test("case and whitespace do not create a second identity", async () => {
  assert.equal(
    await hashSubject("email", " A@E.Test ", PEPPER),
    await hashSubject("email", "a@e.test", PEPPER)
  )
})

test("NO PEPPER MEANS NO SUBJECT — never a raw fallback", async () => {
  assert.equal(await hashSubject("ip", "203.0.113.4", undefined), null)
  assert.equal(await hashSubject("ip", "203.0.113.4", ""), null)
  assert.equal(await hashSubject("email", null, PEPPER), null)
})

// ===========================================================================
// What a claimant is told
// ===========================================================================

test("NO cash-redemption state promises a payout or names an amount", () => {
  for (const state of [
    "requested", "eligibility_review", "eligible", "ineligible",
    "manual_payout_required", "completed", "rejected"
  ]) {
    const badge = cashRedemptionBadge(state)
    assert.ok(badge, `${state} has no wording`)
    const text = `${badge.label} ${badge.detail}`
    assert.doesNotMatch(text, /approv|eligib|qualif|payout|paid|\$|cash will|guarantee/i, state)
  }
})

test("'eligible' does not read as approved", () => {
  // Internally it means a reviewer agreed. To a customer it would read as a
  // promise, and a customer later refused has been misled by us.
  assert.equal(cashRedemptionBadge("eligible")?.label, "Under review")
  assert.equal(cashRedemptionBadge("manual_payout_required")?.label, "Under review")
})

test("no state leaks the legal reasoning", () => {
  for (const state of ["ineligible", "rejected"]) {
    const detail = cashRedemptionBadge(state)?.detail ?? ""
    assert.doesNotMatch(detail, /state law|jurisdiction|promotional|threshold|because/i)
  }
})

test("an unknown state renders nothing rather than a raw value", () => {
  assert.equal(cashRedemptionBadge("wat"), null)
  assert.equal(cashRedemptionBadge(null), null)
  assert.equal(cashRedemptionBadge("__proto__"), null)
})

test("the entry point is offered only when it makes sense", () => {
  assert.equal(canRequestCashRedemption({ hasGiftOriginCredit: true, currentState: null }), true)
  assert.equal(canRequestCashRedemption({ hasGiftOriginCredit: false, currentState: null }), false)

  for (const open of ["requested", "eligibility_review", "eligible", "manual_payout_required"]) {
    assert.equal(
      canRequestCashRedemption({ hasGiftOriginCredit: true, currentState: open }),
      false,
      `${open} must not offer a second button`
    )
  }
  // A closed review does not bar a later one.
  assert.equal(canRequestCashRedemption({ hasGiftOriginCredit: true, currentState: "rejected" }), true)
})
