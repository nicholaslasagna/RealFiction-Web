// Receipt enrichment must never block fulfilment, and only a validated
// HTTPS Stripe-hosted URL may ever be stored (it is rendered into an email).
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []

mock.module("server-only", { namedExports: {}, defaultExport: {} })

const serviceRoleMock = {
  namedExports: {
    getSupabaseServiceRoleClient: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args })
        return { data: [{ already_fulfilled: false, email_queued: true }], error: null }
      }
    }),
    // The real module uses a TS parameter property, which Node's type-stripping
    // rejects; the mock must therefore fully replace it.
    ServiceRoleConfigError: class extends Error {},
    hasServiceRoleConfig: () => true,
    missingServiceRoleConfig: () => []
  }
}

mock.module("@/lib/supabase/service-role", serviceRoleMock)

const { fulfillPaidOrderWithOutbox } = await import("./store-server.ts")

async function fulfilWith(receiptUrl: string | null | undefined) {
  rpcCalls.length = 0
  await fulfillPaidOrderWithOutbox("order-1", {
    paymentIntentId: "pi_1",
    chargeId: "ch_1",
    receiptUrl
  })
  return rpcCalls.find((call) => call.fn === "fulfill_paid_order_with_outbox")!.args
}

test("a valid Stripe HTTPS receipt URL is passed through", async () => {
  const args = await fulfilWith("https://pay.stripe.com/receipts/abc123")
  assert.equal(args.p_receipt_url, "https://pay.stripe.com/receipts/abc123")
})

test("an absent receipt URL becomes null and does not block fulfilment", async () => {
  for (const value of [null, undefined]) {
    const args = await fulfilWith(value)
    assert.equal(args.p_receipt_url, null)
    // Fulfilment still proceeds with the payment refs it does have.
    assert.equal(args.p_payment_intent_id, "pi_1")
    assert.equal(args.p_charge_id, "ch_1")
  }
})

test("a malformed or non-Stripe receipt URL is sanitized to null, never stored", async () => {
  for (const hostile of [
    "http://pay.stripe.com/receipts/x", // not HTTPS
    "https://evil.test/receipts/x", // not Stripe
    "https://stripe.com.evil.test/x", // suffix spoofing
    "javascript:alert(1)",
    "not a url",
    ""
  ]) {
    const args = await fulfilWith(hostile)
    assert.equal(args.p_receipt_url, null, `${hostile || "(empty)"} must not be stored`)
    // ...and fulfilment is unaffected by the bad input.
    assert.equal(args.p_order_id, "order-1")
  }
})

test("malformed receipt data never throws — fulfilment cannot be blocked by it", async () => {
  // Any value the webhook could hand us, however odd, must resolve to a call.
  await assert.doesNotReject(() => fulfilWith("https://" + "x".repeat(5000)))
})
