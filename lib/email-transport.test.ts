// Tests the EXACT production transport function — the only code in the app that
// calls api.resend.com.
import assert from "node:assert/strict"
import { register } from "node:module"
import test from "node:test"

// The transport imports ./queue extensionlessly, as source should.
register("./test-alias-hook.mjs", import.meta.url)

// Static imports are hoisted above register(), so the module under test is
// imported dynamically once the resolver hook is installed.
type EmailTransportConfig = {
  apiKey: string
  from: string
  replyTo: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const { buildResendHeaders, buildResendPayload, RESEND_ENDPOINT, sendProviderEmail } =
  await import("./email/transport.ts")

const CONFIG: EmailTransportConfig = {
  apiKey: "re_secret_value_not_real",
  from: "RealFiction <orders@realfiction.live>",
  replyTo: "support@realfiction.live"
}

const MESSAGE = {
  to: "buyer@example.test",
  subject: "Order confirmed — RF-3F2504E0",
  text: "plain text body",
  html: "<p>html body</p>",
  idempotencyKey: "order_confirmation:order-1"
}

function stub(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
  malformed = false
) {
  const seen: Array<{ url: string; init: RequestInit }> = []
  const impl = (async (url: unknown, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} })
    return new Response(malformed ? "<<not json>>" : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers }
    })
  }) as typeof fetch
  return { impl, seen }
}

test("the production request has the exact endpoint, headers, and JSON payload", async () => {
  const resend = stub(200, { id: "resend-1" })
  await sendProviderEmail(MESSAGE, { ...CONFIG, fetchImpl: resend.impl })

  const { url, init } = resend.seen[0]
  assert.equal(url, RESEND_ENDPOINT)
  assert.equal(init.method, "POST")

  const headers = init.headers as Record<string, string>
  assert.equal(headers.Authorization, "Bearer re_secret_value_not_real")
  assert.equal(headers["Content-Type"], "application/json")
  assert.equal(headers["Idempotency-Key"], "order_confirmation:order-1")

  assert.deepEqual(JSON.parse(String(init.body)), {
    from: "RealFiction <orders@realfiction.live>",
    to: ["buyer@example.test"],
    subject: "Order confirmed — RF-3F2504E0",
    text: "plain text body",
    html: "<p>html body</p>",
    reply_to: "support@realfiction.live"
  })
})

test("the payload builders are the same ones the request uses", () => {
  assert.deepEqual(buildResendPayload(MESSAGE, CONFIG).to, ["buyer@example.test"])
  assert.equal(buildResendHeaders(MESSAGE, CONFIG)["Idempotency-Key"], MESSAGE.idempotencyKey)
  // The API key never appears in the body.
  assert.doesNotMatch(JSON.stringify(buildResendPayload(MESSAGE, CONFIG)), /re_secret_value/)
})

test("an accepted response returns the provider message id", async () => {
  const result = await sendProviderEmail(MESSAGE, {
    ...CONFIG,
    fetchImpl: stub(200, { id: "resend-abc" }).impl
  })
  assert.equal(result.kind, "accepted")
  assert.equal(result.kind === "accepted" ? result.providerMessageId : null, "resend-abc")
})

test("a 2xx with a malformed body is still ACCEPTED, never resent", async () => {
  const result = await sendProviderEmail(MESSAGE, {
    ...CONFIG,
    fetchImpl: stub(200, null, {}, true).impl
  })
  // Resending a message the provider accepted would duplicate it.
  assert.equal(result.kind, "accepted")
  assert.equal(result.kind === "accepted" ? result.providerMessageId : "x", null)
})

test("429 is retryable and carries Retry-After", async () => {
  const result = await sendProviderEmail(MESSAGE, {
    ...CONFIG,
    fetchImpl: stub(429, { name: "rate_limit_exceeded" }, { "Retry-After": "45" }).impl
  })
  assert.equal(result.kind, "retryable")
  assert.equal(result.kind === "retryable" ? result.retryAfterSeconds : null, 45)
  assert.equal(result.kind === "retryable" ? result.category : null, "rate_limited")
})

test("5xx is retryable", async () => {
  const result = await sendProviderEmail(MESSAGE, {
    ...CONFIG,
    fetchImpl: stub(503, { name: "service_unavailable" }).impl
  })
  assert.equal(result.kind, "retryable")
})

test("ordinary 4xx is permanent", async () => {
  for (const status of [400, 401, 403, 422]) {
    const result = await sendProviderEmail(MESSAGE, {
      ...CONFIG,
      fetchImpl: stub(status, { name: "validation_error" }).impl
    })
    assert.equal(result.kind, "permanent", `${status} must not retry`)
  }
})

test("a malformed error body still classifies by status", async () => {
  const result = await sendProviderEmail(MESSAGE, {
    ...CONFIG,
    fetchImpl: stub(500, null, {}, true).impl
  })
  assert.equal(result.kind, "retryable")
  assert.match(result.kind === "retryable" ? result.error : "", /malformed_body/)
})

test("a dispatch timeout is AMBIGUOUS, never a failure", async () => {
  const hang = (async (_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("aborted")
        error.name = "AbortError"
        reject(error)
      })
    })) as typeof fetch

  const result = await sendProviderEmail(MESSAGE, { ...CONFIG, fetchImpl: hang, timeoutMs: 20 })
  // The request went out; we simply stopped waiting. Calling this "failed" and
  // resending with a new key is how duplicates happen.
  assert.equal(result.kind, "ambiguous")
  assert.equal(result.kind === "ambiguous" ? result.category : null, "dispatch_timeout")
})

test("a connection closed mid-flight is AMBIGUOUS", async () => {
  const boom = (async () => {
    throw new TypeError("network error")
  }) as typeof fetch
  const result = await sendProviderEmail(MESSAGE, { ...CONFIG, fetchImpl: boom })
  assert.equal(result.kind, "ambiguous")
  assert.equal(result.kind === "ambiguous" ? result.category : null, "connection_closed")
})

test("no result value ever carries the api key, recipient, body, or HTML", async () => {
  const results = await Promise.all([
    sendProviderEmail(MESSAGE, { ...CONFIG, fetchImpl: stub(200, { id: "x" }).impl }),
    sendProviderEmail(MESSAGE, { ...CONFIG, fetchImpl: stub(429, { name: "rate" }).impl }),
    sendProviderEmail(MESSAGE, { ...CONFIG, fetchImpl: stub(422, { name: "bad" }).impl })
  ])
  for (const result of results) {
    const serialized = JSON.stringify(result)
    assert.doesNotMatch(serialized, /re_secret_value/, "api key")
    assert.doesNotMatch(serialized, /buyer@example\.test/, "recipient")
    assert.doesNotMatch(serialized, /html body/, "rendered HTML")
    assert.doesNotMatch(serialized, /plain text body/, "message body")
  }
})
