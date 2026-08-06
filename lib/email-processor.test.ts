// Scheduled processor behaviour, against a fake Supabase + fake Resend.
//
// The headline guarantee: the Stripe webhook enqueues and returns; ONLY this
// processor talks to Resend.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

type DeliveryRow = {
  id: string
  idempotency_key: string
  template: string
  recipient: string
  order_id: string | null
  params: Record<string, unknown> | null
  attempts: number
}

type RpcCall = { fn: string; args: Record<string, unknown> }

let failingRpc: string | null = null

function fakeSupabase(rows: DeliveryRow[], calls: RpcCall[]) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      if (fn === "claim_due_email_deliveries") {
        return { data: rows, error: null }
      }
      if (fn === failingRpc) {
        return { data: null, error: { message: "db unavailable" } }
      }
      return { data: null, error: null }
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: "order-1",
              status: "fulfilled",
              minecraft_username: "Tester",
              gifted_to_minecraft_username: null,
              subtotal_cents: 499,
              store_credit_applied_cents: 0,
              payment_due_cents: 499,
              total_cents: 499,
              currency: "USD",
              created_at: "2026-07-19T00:00:00Z",
              stripe_receipt_url: "https://pay.stripe.com/receipts/abc"
            }
          })
        }),
        in: async () => ({ data: [] })
      })
    })
  }
}

// The processor builds its own Supabase client. The mock must be registered
// BEFORE the processor module is evaluated, so the processor is imported
// dynamically below rather than with a hoisted static import.
let supabaseCalls: RpcCall[] = []
let queueRows: DeliveryRow[] = []

mock.module("@supabase/supabase-js", {
  namedExports: {
    createClient: () => fakeSupabase(queueRows, supabaseCalls)
  }
})

const { processEmailQueue } = await import("./email/processor.ts")

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  RESEND_API_KEY: "re_test_key",
  EMAIL_FROM: "RealFiction <orders@realfiction.live>",
  EMAIL_SUPPORT_ADDRESS: "support@realfiction.live",
  NEXT_PUBLIC_SITE_URL: "https://realfiction.live"
}

const ORDER_ROW: DeliveryRow = {
  id: "delivery-1",
  idempotency_key: "order_confirmation:order-1",
  template: "order_confirmation",
  recipient: "buyer@example.test",
  order_id: "order-1",
  params: {},
  attempts: 1
}

function resendStub(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  const sent: Array<{ headers: Record<string, string>; body: string }> = []
  const impl = (async (_url: unknown, init?: RequestInit) => {
    sent.push({ headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? "") })
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers }
    })
  }) as typeof fetch
  return { impl, sent }
}

test("a claimed delivery is sent and marked sent with the provider message id", async () => {
  supabaseCalls = []
  queueRows = [ORDER_ROW]
  const resend = resendStub(200, { id: "resend-abc" })

  const result = await processEmailQueue(ENV, { fetchImpl: resend.impl })

  assert.equal(result.claimed, 1)
  assert.equal(result.sent, 1)
  assert.equal(resend.sent.length, 1, "exactly one Resend request")

  const marked = supabaseCalls.find((call) => call.fn === "mark_email_sent")
  assert.ok(marked, "must mark sent")
  assert.equal(marked?.args.p_provider_message_id, "resend-abc")
  assert.equal(marked?.args.p_provider_status_code, 200)
})

test("the SAME deterministic idempotency key is sent to Resend every attempt", async () => {
  supabaseCalls = []
  queueRows = [ORDER_ROW]
  const first = resendStub(200, { id: "m1" })
  await processEmailQueue(ENV, { fetchImpl: first.impl })

  // Simulate: Resend accepted, but our local status write failed, so the row is
  // claimed again. The replay must reuse the key so Resend dedupes it and the
  // customer never receives a second copy.
  supabaseCalls = []
  queueRows = [{ ...ORDER_ROW, attempts: 2 }]
  const second = resendStub(200, { id: "m1" })
  await processEmailQueue(ENV, { fetchImpl: second.impl })

  assert.equal(first.sent[0].headers["Idempotency-Key"], "order_confirmation:order-1")
  assert.equal(second.sent[0].headers["Idempotency-Key"], "order_confirmation:order-1")
})

test("a 429 is retried and honours Retry-After", async () => {
  supabaseCalls = []
  queueRows = [ORDER_ROW]
  const resend = resendStub(429, { name: "rate_limit_exceeded" }, { "Retry-After": "90" })

  const result = await processEmailQueue(ENV, { fetchImpl: resend.impl })

  assert.equal(result.retried, 1)
  const failed = supabaseCalls.find((call) => call.fn === "mark_email_failed")
  assert.equal(failed?.args.p_retryable, true)
  assert.equal(failed?.args.p_retry_after_seconds, 90)
  assert.equal(failed?.args.p_diagnostic_category, "rate_limited")
  assert.equal(failed?.args.p_provider_status_code, 429)
})

test("a 5xx is retried", async () => {
  supabaseCalls = []
  queueRows = [ORDER_ROW]
  const result = await processEmailQueue(ENV, { fetchImpl: resendStub(503, { name: "unavailable" }).impl })
  assert.equal(result.retried, 1)
  assert.equal(supabaseCalls.find((c) => c.fn === "mark_email_failed")?.args.p_retryable, true)
})

test("a permanent 422 rejection is parked, not retried forever", async () => {
  supabaseCalls = []
  queueRows = [ORDER_ROW]
  const result = await processEmailQueue(ENV, { fetchImpl: resendStub(422, { name: "validation_error" }).impl })

  assert.equal(result.parked, 1)
  const failed = supabaseCalls.find((call) => call.fn === "mark_email_failed")
  assert.equal(failed?.args.p_retryable, false)
  assert.equal(failed?.args.p_diagnostic_category, "payload_rejected")
})

test("a connection failure is AMBIGUOUS, not a definite failure", async () => {
  supabaseCalls = []
  queueRows = [ORDER_ROW]
  const boom = (async () => {
    throw new TypeError("network down")
  }) as typeof fetch

  const result = await processEmailQueue(ENV, { fetchImpl: boom })

  // The request may have reached Resend before the connection dropped, so this
  // is explicitly NOT recorded as a failure — it is resolved by replaying the
  // same key inside the provider window.
  assert.equal(result.uncertain, 1)
  assert.equal(result.retried, 0)
  assert.equal(supabaseCalls.find((call) => call.fn === "mark_email_failed"), undefined)
  assert.equal(
    supabaseCalls.find((call) => call.fn === "mark_email_uncertain")?.args.p_category,
    "connection_closed"
  )
})

test("missing RESEND_API_KEY parks as unconfigured and can recover later", async () => {
  supabaseCalls = []
  queueRows = [ORDER_ROW]
  const resend = resendStub(200, { id: "should-not-send" })

  const result = await processEmailQueue({ ...ENV, RESEND_API_KEY: "" }, { fetchImpl: resend.impl })

  assert.equal(result.unconfigured, 1)
  assert.equal(resend.sent.length, 0, "must not attempt a send without a key")
  assert.ok(supabaseCalls.find((c) => c.fn === "mark_email_unconfigured"), "uses the unconfigured state")
  assert.equal(
    supabaseCalls.find((c) => c.fn === "mark_email_failed"),
    undefined,
    "config-missing is NOT a delivery failure and must not consume the attempt budget"
  )

  // Once the binding is added, the same row sends normally.
  supabaseCalls = []
  queueRows = [ORDER_ROW]
  const after = resendStub(200, { id: "resend-after" })
  const recovered = await processEmailQueue(ENV, { fetchImpl: after.impl })
  assert.equal(recovered.sent, 1, "recovers after configuration is added")
})

test("the provider request carries no message body into logs and one recipient", async () => {
  supabaseCalls = []
  queueRows = [ORDER_ROW]
  const resend = resendStub(200, { id: "m" })
  await processEmailQueue(ENV, { fetchImpl: resend.impl })

  const payload = JSON.parse(resend.sent[0].body)
  assert.deepEqual(payload.to, ["buyer@example.test"])
  assert.equal(payload.reply_to, "support@realfiction.live")
  // The stored error strings are status + provider error name only.
  const failed = supabaseCalls.filter((c) => c.fn === "mark_email_failed")
  assert.equal(failed.length, 0)
})

test("a refund delivery renders from its stored params", async () => {
  supabaseCalls = []
  queueRows = [
    {
      id: "delivery-2",
      idempotency_key: "refund_confirmation:re_123",
      template: "refund_confirmation",
      recipient: "buyer@example.test",
      order_id: "order-1",
      params: {
        refundedCents: 1299,
        currency: "USD",
        isFullRefund: true,
        affectedItemName: null,
        entitlementStatus: "revoked"
      },
      attempts: 1
    }
  ]
  const resend = resendStub(200, { id: "m" })
  const result = await processEmailQueue(ENV, { fetchImpl: resend.impl })

  assert.equal(result.sent, 1)
  const payload = JSON.parse(resend.sent[0].body)
  assert.match(payload.subject, /Full refund/)
  assert.match(payload.text, /\$12\.99/)
  assert.doesNotMatch(payload.text, /re_123/, "no Stripe identifiers in customer mail")
})

test("an empty queue does no work and never throws", async () => {
  supabaseCalls = []
  queueRows = []
  const resend = resendStub(200)
  const result = await processEmailQueue(ENV, { fetchImpl: resend.impl })
  assert.deepEqual(result, { claimed: 0, sent: 0, retried: 0, parked: 0, unconfigured: 0, uncertain: 0 })
  assert.equal(resend.sent.length, 0)
})

test("a missing database binding is survivable", async () => {
  const result = await processEmailQueue({ RESEND_API_KEY: "re_x" })
  assert.equal(result.claimed, 0)
})

// -- Provider-idempotency lifecycle ------------------------------------------

test("the provider window opens ONLY when a real request is dispatched", async () => {
  supabaseCalls = []
  queueRows = [ORDER_ROW]
  failingRpc = null
  await processEmailQueue(ENV, { fetchImpl: resendStub(200, { id: "m" }).impl })

  const begin = supabaseCalls.findIndex((c) => c.fn === "begin_email_provider_attempt")
  assert.ok(begin >= 0, "the window is opened before dispatch")
})

test("missing configuration never opens a provider window", async () => {
  supabaseCalls = []
  queueRows = [ORDER_ROW]
  failingRpc = null
  const resend = resendStub(200, { id: "should-not-send" })

  await processEmailQueue({ ...ENV, RESEND_API_KEY: "" }, { fetchImpl: resend.impl })

  assert.equal(resend.sent.length, 0)
  assert.equal(
    supabaseCalls.find((c) => c.fn === "begin_email_provider_attempt"),
    undefined,
    "no provider request means no deadline — the delivery stays recoverable for days"
  )
  assert.ok(supabaseCalls.find((c) => c.fn === "mark_email_unconfigured"))
})

test("provider-accepted + DB persistence failure becomes uncertain, not sent", async () => {
  supabaseCalls = []
  queueRows = [ORDER_ROW]
  failingRpc = "mark_email_sent"
  const resend = resendStub(200, { id: "resend-accepted" })

  const result = await processEmailQueue(ENV, { fetchImpl: resend.impl })

  assert.equal(result.sent, 0)
  assert.equal(result.uncertain, 1)
  const uncertain = supabaseCalls.find((c) => c.fn === "mark_email_uncertain")
  assert.equal(uncertain?.args.p_category, "accepted_persist_failed")
  failingRpc = null
})

test("a retry after a persistence failure reuses the SAME key", async () => {
  supabaseCalls = []
  queueRows = [ORDER_ROW]
  failingRpc = "mark_email_sent"
  const first = resendStub(200, { id: "m" })
  await processEmailQueue(ENV, { fetchImpl: first.impl })

  failingRpc = null
  supabaseCalls = []
  queueRows = [{ ...ORDER_ROW, attempts: 2 }]
  const second = resendStub(200, { id: "m" })
  await processEmailQueue(ENV, { fetchImpl: second.impl })

  // Same key -> Resend suppresses the duplicate while the window is open.
  assert.equal(first.sent[0].headers["Idempotency-Key"], "order_confirmation:order-1")
  assert.equal(second.sent[0].headers["Idempotency-Key"], "order_confirmation:order-1")
})

test("a dispatch timeout is recorded as uncertain, never as a failure", async () => {
  supabaseCalls = []
  queueRows = [ORDER_ROW]
  failingRpc = null
  const hang = (async (_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("aborted")
        error.name = "AbortError"
        reject(error)
      })
    })) as typeof fetch

  const result = await processEmailQueue(ENV, { fetchImpl: hang, timeoutMs: 20 })

  assert.equal(result.uncertain, 1)
  assert.equal(supabaseCalls.find((c) => c.fn === "mark_email_failed"), undefined)
  assert.equal(
    supabaseCalls.find((c) => c.fn === "mark_email_uncertain")?.args.p_category,
    "dispatch_timeout"
  )
})

test("one failing delivery does not abandon the rest of the claimed batch", async () => {
  supabaseCalls = []
  failingRpc = null
  queueRows = [
    { ...ORDER_ROW, id: "d1", idempotency_key: "k1" },
    // Unrenderable template -> permanent, must not stop the batch.
    { ...ORDER_ROW, id: "d2", idempotency_key: "k2", template: "unknown_template" },
    { ...ORDER_ROW, id: "d3", idempotency_key: "k3" }
  ]
  const resend = resendStub(200, { id: "m" })

  const result = await processEmailQueue(ENV, { fetchImpl: resend.impl })

  assert.equal(result.claimed, 3)
  assert.equal(result.sent, 2, "the two good deliveries still send")
  assert.equal(result.parked, 1)
})
