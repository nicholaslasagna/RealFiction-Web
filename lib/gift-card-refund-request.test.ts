// The Stripe refund request for a gift card.
//
// Two properties decide whether a customer can be refunded twice: the amount
// must come from the server, and the idempotency key must be deterministic on
// our own workflow id so a retry after a lost response reaches Stripe's
// ORIGINAL Refund. Everything else here is about not mistaking "we don't know"
// for "it failed".
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

mock.module("server-only", { namedExports: {}, defaultExport: {} })

const { createGiftCardRefund, encodeGiftCardRefundBody, refundIdempotencyKey } = await import(
  "./gift-card/refund-request.ts"
)

const REQUEST = {
  refundId: "refund-abc",
  paymentIntentId: "pi_giftcard_1",
  chargeId: "ch_giftcard_1",
  amountCents: 2500,
  currency: "USD"
}

function transport(status: number, payload: unknown) {
  const seen: { url: string; body: string; headers: Record<string, string> }[] = []
  const impl = (async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers as HeadersInit)
    seen.push({
      url: String(url),
      body: String(init?.body),
      headers: Object.fromEntries(headers.entries())
    })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (payload === "malformed") throw new Error("not json")
        return payload
      }
    } as Response
  }) as unknown as typeof fetch
  return { impl, seen }
}

const succeeded = { id: "re_1", status: "succeeded", amount: 2500 }

// ===========================================================================
// The request
// ===========================================================================

test("the request charges EXACTLY the server-computed amount", () => {
  const body = encodeGiftCardRefundBody(REQUEST)
  assert.equal(body.get("amount"), "2500")
  assert.equal(body.get("payment_intent"), "pi_giftcard_1")
  assert.equal(body.get("metadata[realfiction_refund_id]"), "refund-abc")
})

test("a charge id is the fallback when no PaymentIntent was recorded", () => {
  const body = encodeGiftCardRefundBody({ ...REQUEST, paymentIntentId: null })
  assert.equal(body.get("charge"), "ch_giftcard_1")
  assert.equal(body.get("payment_intent"), null)
})

test("the idempotency key is DETERMINISTIC on our workflow id", () => {
  // A timestamp or nonce here would let a retry create a second Refund, which
  // is exactly the double-refund this prevents.
  const first = refundIdempotencyKey("refund-abc")
  const second = refundIdempotencyKey("refund-abc")
  assert.equal(first, second)
  assert.equal(first, "realfiction-giftcard-refund:refund-abc")
  assert.notEqual(first, refundIdempotencyKey("refund-xyz"))
})

test("the live request carries that key and the pinned API version", async () => {
  const stripe = transport(200, succeeded)
  await createGiftCardRefund(REQUEST, { secretKey: "sk_test_fake", fetchImpl: stripe.impl })

  assert.equal(stripe.seen[0].url, "https://api.stripe.com/v1/refunds")
  assert.equal(stripe.seen[0].headers["idempotency-key"], "realfiction-giftcard-refund:refund-abc")
  assert.ok(stripe.seen[0].headers["stripe-version"], "the API version is pinned")
  assert.match(stripe.seen[0].body, /amount=2500/)
})

test("a RETRY reaches the same Stripe Refund, not a second one", async () => {
  const stripe = transport(200, succeeded)
  await createGiftCardRefund(REQUEST, { secretKey: "sk_test_fake", fetchImpl: stripe.impl })
  await createGiftCardRefund(REQUEST, { secretKey: "sk_test_fake", fetchImpl: stripe.impl })

  assert.equal(stripe.seen[0].headers["idempotency-key"], stripe.seen[1].headers["idempotency-key"])
})

test("no client-supplied field can reach the request", () => {
  const body = encodeGiftCardRefundBody({
    ...REQUEST,
    // Even if a caller smuggled these in, only known fields are encoded.
    ...({ price: 1, faceValue: 9999, currencyOverride: "EUR" } as never)
  })
  for (const key of ["price", "faceValue", "currencyOverride"]) {
    assert.equal(body.get(key), null)
  }
  assert.equal(body.get("amount"), "2500")
})

// ===========================================================================
// Success
// ===========================================================================

test("a succeeded refund reports the provider id and echoed amount", async () => {
  const result = await createGiftCardRefund(REQUEST, {
    secretKey: "sk_test_fake",
    fetchImpl: transport(200, succeeded).impl
  })

  assert.equal(result.kind, "succeeded")
  assert.equal(result.kind === "succeeded" && result.providerRefundId, "re_1")
  assert.equal(result.kind === "succeeded" && result.amountCents, 2500)
})

test("a PENDING refund is not treated as success", async () => {
  const result = await createGiftCardRefund(REQUEST, {
    secretKey: "sk_test_fake",
    fetchImpl: transport(200, { id: "re_2", status: "pending" }).impl
  })
  assert.equal(result.kind, "pending")
})

// ===========================================================================
// Failure versus uncertainty — the distinction that prevents double refunds
// ===========================================================================

test("a 429 or 5xx is UNCERTAIN, never failed", async () => {
  // Stripe may have created the Refund and lost the response. Calling this
  // "failed" would let a caller unfreeze value that is already being returned.
  for (const status of [429, 500, 502, 503]) {
    const result = await createGiftCardRefund(REQUEST, {
      secretKey: "sk_test_fake",
      fetchImpl: transport(status, { error: { code: "x" } }).impl
    })
    assert.equal(result.kind, "uncertain", `status ${status} must be uncertain`)
  }
})

test("a TIMEOUT is uncertain", async () => {
  const hung = (async (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
    })) as unknown as typeof fetch

  const started = Date.now()
  const result = await createGiftCardRefund(REQUEST, {
    secretKey: "sk_test_fake",
    fetchImpl: hung,
    timeoutMs: 1_000
  })

  assert.ok(Date.now() - started < 5_000, "the call must be bounded")
  assert.equal(result.kind, "uncertain")
  assert.equal(result.kind === "uncertain" && result.category, "provider_unreachable")
})

test("a MALFORMED response is uncertain, not failed", async () => {
  const result = await createGiftCardRefund(REQUEST, {
    secretKey: "sk_test_fake",
    fetchImpl: transport(200, "malformed").impl
  })
  assert.equal(result.kind, "uncertain")
})

test("a response with no refund id is uncertain", async () => {
  const result = await createGiftCardRefund(REQUEST, {
    secretKey: "sk_test_fake",
    fetchImpl: transport(200, { status: "succeeded", amount: 2500 }).impl
  })
  assert.equal(result.kind, "uncertain")
})

test("a definitive 4xx rejection IS failed", async () => {
  const result = await createGiftCardRefund(REQUEST, {
    secretKey: "sk_test_fake",
    fetchImpl: transport(400, { error: { type: "invalid_request_error", code: "charge_already_refunded" } }).impl
  })

  assert.equal(result.kind, "failed")
  assert.equal(result.kind === "failed" && result.category, "invalid_request_error/charge_already_refunded")
})

test("a failed or canceled Refund object is failed", async () => {
  for (const status of ["failed", "canceled"]) {
    const result = await createGiftCardRefund(REQUEST, {
      secretKey: "sk_test_fake",
      fetchImpl: transport(200, { id: "re_3", status }).impl
    })
    assert.equal(result.kind, "failed")
  }
})

// ===========================================================================
// Leakage
// ===========================================================================

test("no result ever carries the secret key or Stripe's human message", async () => {
  const results = []
  for (const [status, payload] of [
    [400, { error: { type: "card_error", code: "x", message: "sk_test_fake was rejected" } }],
    [500, { error: { message: "sk_test_fake" } }],
    [200, "malformed"]
  ] as const) {
    results.push(
      await createGiftCardRefund(REQUEST, {
        secretKey: "sk_test_fake",
        fetchImpl: transport(status, payload).impl
      })
    )
  }

  const body = JSON.stringify(results)
  assert.ok(!body.includes("sk_test_fake"), "a result carried the secret key")
  assert.ok(!body.includes("was rejected"), "a result carried Stripe's human message")
})
