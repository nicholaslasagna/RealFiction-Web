import assert from "node:assert/strict"
import test from "node:test"

import {
  checkLivemode,
  classifyRefundScope,
  classifyStripeEvent,
  orderIdFromSession,
  resolveStripeEnvironment,
  revocationOperationKey
} from "./stripe-events.ts"

const ORDER = "11111111-1111-4111-8111-111111111111"

function sessionEvent(type: string, object: Record<string, unknown>) {
  return { id: `evt_${type}`, type, livemode: true, data: { object } }
}

// -- Environment separation ---------------------------------------------------

test("stripe environment resolves live/test and fails closed otherwise", () => {
  assert.equal(resolveStripeEnvironment("live"), "live")
  assert.equal(resolveStripeEnvironment("LIVE"), "live")
  assert.equal(resolveStripeEnvironment("test"), "test")
  assert.equal(resolveStripeEnvironment(undefined), null)
  assert.equal(resolveStripeEnvironment(""), null)
  assert.equal(resolveStripeEnvironment("production"), null)
})

test("live production rejects a test-mode event", () => {
  const result = checkLivemode({ id: "evt_1", type: "x", livemode: false }, "live")
  assert.equal(result.ok, false)
  assert.match(result.ok === false ? result.reason : "", /livemode_mismatch/)
})

test("live production accepts a live event", () => {
  assert.deepEqual(checkLivemode({ id: "evt_1", type: "x", livemode: true }, "live"), { ok: true })
})

test("test environment rejects a live event (no cross-contamination either way)", () => {
  const result = checkLivemode({ id: "evt_1", type: "x", livemode: true }, "test")
  assert.equal(result.ok, false)
})

test("unconfigured environment rejects every event (fail closed)", () => {
  const result = checkLivemode({ id: "evt_1", type: "x", livemode: true }, null)
  assert.equal(result.ok, false)
  assert.equal(result.ok === false ? result.reason : "", "stripe_environment_unconfigured")
})

test("missing livemode field is rejected", () => {
  const result = checkLivemode({ id: "evt_1", type: "x" }, "live")
  assert.equal(result.ok, false)
  assert.equal(result.ok === false ? result.reason : "", "livemode_missing")
})

// -- Checkout session events --------------------------------------------------

test("completed + paid fulfills", () => {
  const action = classifyStripeEvent(
    sessionEvent("checkout.session.completed", {
      metadata: { order_id: ORDER },
      payment_status: "paid",
      payment_intent: "pi_123"
    })
  )
  assert.equal(action.kind, "fulfill")
  assert.equal(action.kind === "fulfill" ? action.orderId : null, ORDER)
  assert.equal(action.kind === "fulfill" ? action.paymentIntentId : null, "pi_123")
})

test("completed but UNPAID does not fulfill — waits for async payment", () => {
  const action = classifyStripeEvent(
    sessionEvent("checkout.session.completed", {
      metadata: { order_id: ORDER },
      payment_status: "unpaid",
      status: "complete"
    })
  )
  assert.equal(action.kind, "await_async_payment")
})

test("async_payment_succeeded fulfills", () => {
  const action = classifyStripeEvent(
    sessionEvent("checkout.session.async_payment_succeeded", {
      metadata: { order_id: ORDER },
      payment_status: "paid"
    })
  )
  assert.equal(action.kind, "fulfill")
})

test("async_payment_failed releases credit and never fulfills", () => {
  const action = classifyStripeEvent(
    sessionEvent("checkout.session.async_payment_failed", { metadata: { order_id: ORDER } })
  )
  assert.equal(action.kind, "release")
  assert.equal(action.kind === "release" ? action.reason : null, "payment_failed")
})

test("expired session releases credit", () => {
  const action = classifyStripeEvent(
    sessionEvent("checkout.session.expired", { metadata: { order_id: ORDER } })
  )
  assert.equal(action.kind, "release")
  assert.equal(action.kind === "release" ? action.reason : null, "expired")
})

test("order id falls back to client_reference_id", () => {
  assert.equal(orderIdFromSession({ client_reference_id: ORDER }), ORDER)
  assert.equal(orderIdFromSession({ metadata: { order_id: ORDER }, client_reference_id: "other" }), ORDER)
  assert.equal(orderIdFromSession({}), null)
})

test("session without any order id is ignored, never guessed", () => {
  const action = classifyStripeEvent(sessionEvent("checkout.session.completed", { payment_status: "paid" }))
  assert.equal(action.kind, "ignore")
})

// -- Refunds ------------------------------------------------------------------

test("refund.created while pending does NOT revoke", () => {
  const action = classifyStripeEvent(
    sessionEvent("refund.created", { status: "pending", payment_intent: "pi_1", amount: 499 })
  )
  assert.equal(action.kind, "record_only")
})

test("refund succeeded revokes", () => {
  const action = classifyStripeEvent(
    sessionEvent("refund.updated", { status: "succeeded", payment_intent: "pi_1", amount: 499 })
  )
  assert.equal(action.kind, "revoke")
  assert.equal(action.kind === "revoke" ? action.mode : null, "refund")
})

test("refund.failed never revokes access", () => {
  const action = classifyStripeEvent(
    sessionEvent("refund.failed", { status: "failed", payment_intent: "pi_1", amount: 499 })
  )
  assert.equal(action.kind, "record_only")
  assert.equal(action.kind === "record_only" ? action.reason : null, "refund_failed")
})

test("full refund is detected as full", () => {
  const scope = classifyRefundScope(1299, 1299, [{ id: "item-1", totalCents: 1299 }])
  assert.equal(scope.kind, "full")
})

test("partial refund matching exactly one item is partial-but-identified", () => {
  const scope = classifyRefundScope(499, 1798, [
    { id: "item-1", totalCents: 499 },
    { id: "item-2", totalCents: 1299 }
  ])
  assert.equal(scope.kind, "partial")
  assert.equal(scope.kind === "partial" ? scope.unambiguousOrderItemId : null, "item-1")
})

test("ambiguous partial refund identifies no item (manual review)", () => {
  const scope = classifyRefundScope(499, 1497, [
    { id: "item-1", totalCents: 499 },
    { id: "item-2", totalCents: 499 },
    { id: "item-3", totalCents: 499 }
  ])
  assert.equal(scope.kind, "partial")
  assert.equal(scope.kind === "partial" ? scope.unambiguousOrderItemId : null, null)
})

test("refund scope is unknown when the charged amount is not known", () => {
  assert.equal(classifyRefundScope(499, null, []).kind, "unknown")
  assert.equal(classifyRefundScope(0, 1299, []).kind, "unknown")
})

// -- Disputes -----------------------------------------------------------------

test("dispute created revokes as chargeback", () => {
  const action = classifyStripeEvent(
    sessionEvent("charge.dispute.created", { payment_intent: "pi_1", status: "needs_response" })
  )
  assert.equal(action.kind, "revoke")
  assert.equal(action.kind === "revoke" ? action.mode : null, "chargeback")
})

test("dispute closed LOST stays revoked", () => {
  const action = classifyStripeEvent(
    sessionEvent("charge.dispute.closed", { payment_intent: "pi_1", status: "lost" })
  )
  assert.equal(action.kind, "revoke")
  assert.equal(action.kind === "revoke" ? action.mode : null, "chargeback")
})

test("dispute closed WON goes to manual review, never auto-restores", () => {
  const action = classifyStripeEvent(
    sessionEvent("charge.dispute.closed", { payment_intent: "pi_1", status: "won" })
  )
  assert.equal(action.kind, "manual_review")
  assert.equal(action.kind === "manual_review" ? action.reason : null, "dispute_closed_won")
})

test("unhandled event types are ignored, not acted on", () => {
  const action = classifyStripeEvent(sessionEvent("customer.created", {}))
  assert.equal(action.kind, "ignore")
})

test("every one of the nine configured production events is handled", () => {
  const configured = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
    "refund.created",
    "refund.updated",
    "refund.failed",
    "charge.dispute.created",
    "charge.dispute.closed"
  ]
  for (const type of configured) {
    const action = classifyStripeEvent(
      sessionEvent(type, { metadata: { order_id: ORDER }, payment_status: "paid", status: "succeeded" })
    )
    assert.notEqual(action.kind, "ignore", `${type} must be handled`)
  }
})

// -- Refund/dispute operation identity (idempotency beyond event-id dedupe) ---

test("one refund produces ONE operation key across created + updated + replays", () => {
  // Stripe sends distinct event ids for refund.created and each refund.updated.
  // Event-id dedupe alone therefore cannot stop repeated revocation; the key
  // must come from the refund OBJECT id.
  const refund = { id: "re_ABC123", status: "succeeded", payment_intent: "pi_1", amount: 1299 }

  const created = classifyStripeEvent({
    id: "evt_created", type: "refund.created", livemode: true, data: { object: refund }
  })
  const updated = classifyStripeEvent({
    id: "evt_updated_1", type: "refund.updated", livemode: true, data: { object: refund }
  })
  const updatedAgain = classifyStripeEvent({
    id: "evt_updated_2", type: "refund.updated", livemode: true, data: { object: refund }
  })

  assert.equal(created.kind, "revoke")
  assert.equal(updated.kind, "revoke")
  assert.equal(updatedAgain.kind, "revoke")

  const keys = new Set([
    created.kind === "revoke" ? created.operationKey : null,
    updated.kind === "revoke" ? updated.operationKey : null,
    updatedAgain.kind === "revoke" ? updatedAgain.operationKey : null
  ])
  assert.equal(keys.size, 1, "three different event ids must share ONE operation key")
  assert.equal([...keys][0], "refund:re_ABC123")
})

test("two DIFFERENT refunds get different operation keys", () => {
  const a = classifyStripeEvent({
    id: "evt_a", type: "refund.updated", livemode: true,
    data: { object: { id: "re_A", status: "succeeded", amount: 100 } }
  })
  const b = classifyStripeEvent({
    id: "evt_b", type: "refund.updated", livemode: true,
    data: { object: { id: "re_B", status: "succeeded", amount: 100 } }
  })
  assert.notEqual(
    a.kind === "revoke" ? a.operationKey : null,
    b.kind === "revoke" ? b.operationKey : null
  )
})

test("repeated dispute updates share one chargeback operation key", () => {
  const dispute = { id: "dp_XYZ", payment_intent: "pi_2", status: "needs_response" }
  const created = classifyStripeEvent({
    id: "evt_d1", type: "charge.dispute.created", livemode: true, data: { object: dispute }
  })
  const closedLost = classifyStripeEvent({
    id: "evt_d2", type: "charge.dispute.closed", livemode: true,
    data: { object: { ...dispute, status: "lost" } }
  })

  assert.equal(created.kind, "revoke")
  assert.equal(closedLost.kind, "revoke")
  assert.equal(
    created.kind === "revoke" ? created.operationKey : null,
    closedLost.kind === "revoke" ? closedLost.operationKey : null,
    "dispute created and closed(lost) are ONE revocation, not two"
  )
  assert.equal(created.kind === "revoke" ? created.operationKey : null, "chargeback:dp_XYZ")
})

test("refund and dispute keys never collide even on an identical object id", () => {
  assert.notEqual(
    revocationOperationKey({ id: "obj_1" }, "refund"),
    revocationOperationKey({ id: "obj_1" }, "chargeback")
  )
})

test("an object with no id yields no operation key (caller must not revoke blindly)", () => {
  assert.equal(revocationOperationKey({}, "refund"), null)
  assert.equal(revocationOperationKey({ id: "" }, "refund"), null)
})
