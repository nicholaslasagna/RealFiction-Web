// Exact Stripe Checkout Session request encoding.
//
// receipt_email is NOT a valid top-level Checkout Session parameter — it belongs
// on the PaymentIntent. Sending it at the top level is silently ignored by
// Stripe, which would mean no receipt with no error. This asserts the wire form.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

let captured: { url: string; headers: Record<string, string>; body: string } | null = null

mock.module("server-only", { namedExports: {}, defaultExport: {} })

globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  captured = {
    url: String(input),
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: String(init?.body ?? "")
  }
  return new Response(
    JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.com/x", expires_at: 1900000000 }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )
}) as typeof fetch

process.env.STRIPE_SECRET_KEY = "sk_test_placeholder_not_a_real_key"

const { createStripeCheckout } = await import("./payments.ts")

const LINE = {
  product: {
    id: "p1",
    slug: "realvip-3m",
    category: "supporter",
    name: "RealVIP 1 Month",
    description: "Supporter rank",
    price_cents: 499,
    currency: "USD",
    fulfillment_type: "subscription" as const,
    duration_days: 30,
    metadata: {},
    active: true
  },
  quantity: 1,
  lineTotalCents: 499
}

async function encode(overrides: Record<string, unknown> = {}) {
  captured = null
  await createStripeCheckout(
    {
      id: "11111111-1111-4111-8111-111111111111",
      provider: "stripe",
      buyerEmail: "buyer@example.test",
      minecraftUsername: "Tester",
      ...overrides
    } as never,
    [LINE]
  )
  return new URLSearchParams(captured!.body)
}

test("the form body carries customer_email and payment_intent_data[receipt_email]", async () => {
  const form = await encode()
  assert.equal(form.get("customer_email"), "buyer@example.test")
  assert.equal(form.get("payment_intent_data[receipt_email]"), "buyer@example.test")
})

test("receipt_email is NEVER sent as a top-level Checkout parameter", async () => {
  const form = await encode()
  assert.equal(form.get("receipt_email"), null, "top-level receipt_email is silently ignored by Stripe")
  // Belt and braces on the raw wire form.
  assert.doesNotMatch(captured!.body, /(^|&)receipt_email=/)
})

test("no email fields are sent when the order carries no buyer email", async () => {
  const form = await encode({ buyerEmail: null })
  assert.equal(form.get("customer_email"), null)
  assert.equal(form.get("payment_intent_data[receipt_email]"), null)
})

test("mode is payment and the session expiry is explicit", async () => {
  const form = await encode()
  assert.equal(form.get("mode"), "payment")
  assert.ok(Number(form.get("expires_at")) > Math.floor(Date.now() / 1000))
  assert.equal(form.get("after_expiration[recovery][enabled]"), null, "recovery must stay off")
})

test("the request pins the API version and a deterministic idempotency key", async () => {
  await encode()
  const headers = captured!.headers
  assert.equal(headers["Stripe-Version"], "2026-04-22.dahlia")
  assert.equal(headers["Idempotency-Key"], "realfiction-checkout:11111111-1111-4111-8111-111111111111")
})

test("the secret key travels only in the Authorization header, never the body", async () => {
  await encode()
  assert.match(captured!.headers.Authorization, /^Bearer sk_test_/)
  assert.doesNotMatch(captured!.body, /sk_test_/)
})

// -- Dynamic payment methods --------------------------------------------------
//
// Stripe decides which methods a buyer is offered (location, device, currency,
// amount) from the Dashboard-managed configuration. Sending payment_method_types
// would OVERRIDE that and silently pin checkout to whatever we listed.

test("payment_method_types is absent, so Dashboard-managed dynamic methods apply", async () => {
  const form = await encode()
  assert.equal(form.get("payment_method_types"), null)
  assert.equal(form.get("payment_method_types[]"), null)
  assert.equal(form.get("payment_method_types[0]"), null)
  // Nothing resembling the field may appear anywhere in the wire body.
  assert.doesNotMatch(captured!.body, /payment_method_types/)
})

test("no automatic-payment-method setting disables Dashboard-managed methods", async () => {
  await encode()
  assert.doesNotMatch(captured!.body, /automatic_payment_methods/)
  assert.doesNotMatch(captured!.body, /payment_method_configuration/)
})

test("line items and currency are still sent correctly alongside dynamic methods", async () => {
  const form = await encode()
  assert.equal(form.get("line_items[0][quantity]"), "1")
  assert.equal(form.get("line_items[0][price_data][currency]"), "usd")
  assert.equal(form.get("line_items[0][price_data][unit_amount]"), "499")
  assert.equal(form.get("line_items[0][price_data][product_data][name]"), "RealVIP 1 Month")
})

test("buyer email fields are unaffected by the dynamic-method configuration", async () => {
  const form = await encode()
  assert.equal(form.get("customer_email"), "buyer@example.test")
  assert.equal(form.get("payment_intent_data[receipt_email]"), "buyer@example.test")
  assert.equal(form.get("receipt_email"), null)
})
