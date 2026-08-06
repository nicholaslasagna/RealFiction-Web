// Provider-verdict classification. Every branch decides whether a customer who
// may already have paid keeps their reservation, so each is asserted directly.
import assert from "node:assert/strict"
import { register } from "node:module"
import test from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

// Dynamic: static imports hoist above register(), and reconcile-upgrades.ts
// reaches the shared facts module by an extensionless path.
const { classifySession } = await import("./store/reconcile-upgrades.ts")

const EXPECTED = {
  orderId: "order-1",
  sessionId: "cs_1",
  expectedAmountCents: 1700,
  expectedCurrency: "USD",
  liveMode: true
}

const BASE = {
  id: "cs_1",
  livemode: true,
  currency: "usd",
  amount_total: 1700,
  metadata: { order_id: "order-1" }
}

test("a paid session reports paid", () => {
  assert.equal(classifySession({ ...BASE, status: "complete", payment_status: "paid" }, EXPECTED), "paid")
})

test("complete-but-unsettled reports async pending, never released", () => {
  assert.equal(
    classifySession({ ...BASE, status: "complete", payment_status: "unpaid" }, EXPECTED),
    "async_pending"
  )
})

test("an open unpaid session is still payable", () => {
  assert.equal(
    classifySession({ ...BASE, status: "open", payment_status: "unpaid" }, EXPECTED),
    "async_pending"
  )
})

test("an expired session reports expired_unpaid", () => {
  assert.equal(
    classifySession({ ...BASE, status: "expired", payment_status: "unpaid" }, EXPECTED),
    "expired_unpaid"
  )
})

test("a missing or unreachable session HOLDS", () => {
  assert.equal(classifySession(null, EXPECTED), "provider_unreachable")
  assert.equal(classifySession({}, EXPECTED), "provider_unreachable")
})

test("an unrecognised state HOLDS rather than releasing", () => {
  assert.equal(
    classifySession({ ...BASE, status: "something_new", payment_status: "weird" }, EXPECTED),
    "provider_unreachable"
  )
})

// -- Binding and environment proofs ------------------------------------------

test("a session belonging to ANOTHER order cannot drive this reconciliation", () => {
  assert.equal(
    classifySession(
      { ...BASE, metadata: { order_id: "someone-elses-order" }, status: "expired" },
      EXPECTED
    ),
    "mismatch"
  )
})

test("a swapped session id is rejected", () => {
  assert.equal(
    classifySession({ ...BASE, id: "cs_other", status: "expired" }, EXPECTED),
    "mismatch"
  )
})

test("client_reference_id is accepted as the order binding when metadata is absent", () => {
  assert.equal(
    classifySession(
      { id: "cs_1", livemode: true, currency: "usd", amount_total: 1700,
        client_reference_id: "order-1", status: "complete", payment_status: "paid" },
      EXPECTED
    ),
    "paid"
  )
})

test("a test-mode session cannot resolve a live order", () => {
  assert.equal(
    classifySession({ ...BASE, livemode: false, status: "expired" }, EXPECTED),
    "mismatch"
  )
})

test("a currency mismatch fails closed", () => {
  assert.equal(
    classifySession({ ...BASE, currency: "eur", status: "expired" }, EXPECTED),
    "mismatch"
  )
})

test("an amount mismatch fails closed", () => {
  // Someone paid a different amount than this order expects — never release,
  // and never fulfil on that basis.
  assert.equal(
    classifySession({ ...BASE, amount_total: 100, status: "complete", payment_status: "paid" }, EXPECTED),
    "mismatch"
  )
})

test("mismatch is never a release verdict", () => {
  // The SQL layer treats anything outside its release set as a hold; assert the
  // classifier never emits a releasing verdict for a mismatched session.
  const releasing = new Set(["expired_unpaid", "payment_failed"])
  for (const session of [
    { ...BASE, metadata: { order_id: "other" }, status: "expired" },
    { ...BASE, livemode: false, status: "expired" },
    { ...BASE, currency: "gbp", status: "expired" },
    { ...BASE, amount_total: 1, status: "expired" }
  ]) {
    assert.ok(!releasing.has(classifySession(session, EXPECTED)), "mismatch must not release")
  }
})
