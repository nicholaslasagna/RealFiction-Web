// The cash-redemption POST route, through its REAL guard stack.
//
// WHY THIS EXISTS
// ===============
// Production returned `403 {"error":"Method not allowed."}` for a legitimate
// same-origin request, and nothing reached the database. `checkSameOrigin` had
// unit coverage, but nothing exercised it THROUGH the route — so an integration
// fault (guard order, a wrong message, an origin the deployed bundle does not
// recognise) had no test that would fail.
//
// These drive the exported `POST` with real `Request` objects and real headers,
// and assert on whether the RPC was reached. The RPC call is the only honest
// signal: a 200 could be produced by a guard short-circuiting, but a recorded
// `request_cash_redemption` call cannot.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)
mock.module("server-only", { namedExports: {}, defaultExport: {} })

const SITE = "https://realfiction.live"
process.env.NEXT_PUBLIC_SITE_URL = SITE
process.env.ABUSE_SUBJECT_PEPPER = "test-only-not-a-real-value"

const session = { user: null as { id: string; email: string } | null }
/** Every RPC the route reaches. The proof that execution got that far. */
const rpcCalls: string[] = []

mock.module("@/lib/supabase/server", {
  namedExports: { getAuthenticatedUser: async () => session.user }
})
mock.module("@/lib/supabase/service-role", {
  namedExports: {
    getSupabaseServiceRoleClient: () => ({
      rpc: async (fn: string) => {
        rpcCalls.push(fn)
        return { data: [{ request_id: "r-1", state: "requested", reason: null }], error: null }
      }
    })
  }
})
// Abuse controls are exercised by their own suite; here they must simply allow.
mock.module("@/lib/abuse/guard", {
  namedExports: {
    ABUSE_BLOCKED_MESSAGE: "blocked",
    ABUSE_UNAVAILABLE_MESSAGE: "unavailable",
    areAbuseControlsConfigured: () => true,
    checkActorRule: async () => ({ decision: "allow", rule: null }),
    recordAbuseEvent: async () => {},
    resolveSubjects: async () => ({ actor: "u", emailHash: null, ipHash: null, recipientHash: null })
  }
})

const { POST, GET } = await import("../app/api/store/gift-cards/cash-redemption/route.ts")
const sameOriginModule = await import("./auth/same-origin.ts")
const require_same_origin = () => sameOriginModule

const USER = { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "player@example.com" }

function request(init: { method?: string; origin?: string | null; referer?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (init.origin !== null && init.origin !== undefined) headers.Origin = init.origin
  if (init.referer) headers.Referer = init.referer
  return new Request(`${SITE}/api/store/gift-cards/cash-redemption`, {
    method: init.method ?? "POST",
    headers,
    body: init.method === "GET" ? undefined : "{}"
  })
}

function reset() {
  rpcCalls.length = 0
  session.user = USER
}

// ===========================================================================
// The exact production case
// ===========================================================================

test("THE PRODUCTION CASE: authenticated same-origin POST REACHES the RPC", async () => {
  reset()
  const response = await POST(request({ origin: SITE }))
  const body = (await response.json()) as { status?: string; error?: string }

  assert.notEqual(
    body.error,
    "Method not allowed.",
    "the legitimate request was refused as a bad method"
  )
  assert.notEqual(response.status, 403, `same-origin POST was rejected: ${JSON.stringify(body)}`)
  assert.equal(response.status, 200, JSON.stringify(body))
  assert.deepEqual(
    rpcCalls,
    ["request_cash_redemption"],
    "execution did not reach the RPC — a guard stopped it"
  )
})

test("the site origin is recognised with a trailing slash and mixed case", async () => {
  // `new URL().origin` normalises both; a string compare on the raw header
  // would not, and that is the shape a real browser sometimes sends.
  for (const origin of [`${SITE}/`, "HTTPS://REALFICTION.LIVE", `${SITE}:443`]) {
    reset()
    const response = await POST(request({ origin }))
    assert.equal(response.status, 200, `origin ${origin} was rejected`)
    assert.deepEqual(rpcCalls, ["request_cash_redemption"], `origin ${origin} did not reach the RPC`)
  }
})

test("a request with NO Origin header is allowed (documented contract)", async () => {
  // No browser can produce a credentialed cross-site mutation without it, and
  // the session cookie is still required. Asserted so the contract is visible.
  reset()
  const response = await POST(request({ origin: null }))
  assert.equal(response.status, 200)
  assert.deepEqual(rpcCalls, ["request_cash_redemption"])
})

// ===========================================================================
// Hostile origins stop BEFORE the RPC
// ===========================================================================

test("HOSTILE origins are rejected before the RPC", async () => {
  const hostile = [
    "https://evil.example",
    "https://realfiction.live.evil.example",   // suffix trick
    "https://evil-realfiction.live",           // prefix trick
    "https://realfictionXlive",                // unescaped-dot trick
    "http://realfiction.live",                 // wrong scheme
    "https://sub.realfiction.live",            // subdomain, not intended
    "null",                                    // sandboxed iframe
    "not-a-url"
  ]

  for (const origin of hostile) {
    reset()
    const response = await POST(request({ origin }))
    const body = (await response.json()) as { error?: string }

    assert.equal(response.status, 403, `origin ${JSON.stringify(origin)} was not rejected`)
    assert.deepEqual(rpcCalls, [], `origin ${JSON.stringify(origin)} reached the RPC`)
    // The intended message — NOT the method wording production returned.
    assert.equal(body.error, "Something in your request does not look right.")
  }
})

test("an EMPTY Origin header is treated as absent, not as hostile", () => {
  // Asserted deliberately rather than left ambiguous. An empty header value
  // carries no origin information, so it is identical to no header at all, and
  // the documented contract already allows absent — a browser cannot produce a
  // credentialed cross-site mutation without it, and the session cookie is
  // still required. Browsers send a real origin or the literal "null"; they do
  // not send an empty one.
  const { checkSameOrigin } = require_same_origin()
  assert.deepEqual(checkSameOrigin(request({ origin: "" })), { ok: true })
  assert.deepEqual(checkSameOrigin(request({ origin: null })), { ok: true })
  // The literal "null" a sandboxed frame sends IS rejected.
  assert.equal(checkSameOrigin(request({ origin: "null" })).ok, false)
})

test("a hostile REFERER cannot substitute for a valid Origin", async () => {
  reset()
  const response = await POST(request({ origin: "https://evil.example", referer: `${SITE}/account` }))
  assert.equal(response.status, 403)
  assert.deepEqual(rpcCalls, [], "a forged Referer got past the Origin check")
})

test("the guard runs BEFORE authentication, so it cannot be probed while signed out", async () => {
  reset()
  session.user = null
  const response = await POST(request({ origin: "https://evil.example" }))
  assert.equal(response.status, 403, "a cross-origin request revealed the auth state instead")
  assert.deepEqual(rpcCalls, [])
})

// ===========================================================================
// Method semantics
// ===========================================================================

test("GET remains 405 Method not allowed, and never mutates", async () => {
  reset()
  const response = await GET()
  const body = (await response.json()) as { error?: string }

  assert.equal(response.status, 405, "the method rejection must be 405, not 403")
  assert.equal(body.error, "Method not allowed.")
  assert.deepEqual(rpcCalls, [])
})

test("403 and 405 are never conflated", async () => {
  // Production returned 403 paired with "Method not allowed.". The two live in
  // different guards and must stay distinguishable: one is authorization, the
  // other is HTTP semantics.
  reset()
  const crossOrigin = await POST(request({ origin: "https://evil.example" }))
  const crossBody = (await crossOrigin.json()) as { error?: string }
  const wrongMethod = await GET()
  const methodBody = (await wrongMethod.json()) as { error?: string }

  assert.equal(crossOrigin.status, 403)
  assert.notEqual(crossBody.error, "Method not allowed.")
  assert.equal(wrongMethod.status, 405)
  assert.equal(methodBody.error, "Method not allowed.")
})

// ===========================================================================
// The configuration that decides the allowlist
// ===========================================================================

test("a MISSING site URL does not silently trust the production origin", async () => {
  // If NEXT_PUBLIC_SITE_URL is absent from the BUILD, the allowlist falls back
  // to localhost only and every real request 403s. Asserted so that failure
  // mode is visible here rather than only in production.
  reset()
  const saved = process.env.NEXT_PUBLIC_SITE_URL
  delete process.env.NEXT_PUBLIC_SITE_URL

  const response = await POST(request({ origin: SITE }))
  process.env.NEXT_PUBLIC_SITE_URL = saved

  assert.equal(response.status, 403, "the guard trusted the site origin with no configuration")
  assert.deepEqual(rpcCalls, [])
})

test("with the site URL configured, the production origin is the ONLY web origin trusted", async () => {
  reset()
  const { allowedOrigins } = await import("./auth/same-origin.ts")
  const origins = allowedOrigins({ NEXT_PUBLIC_SITE_URL: SITE })

  assert.ok(origins.includes(SITE), "the configured origin is missing from the allowlist")
  assert.ok(!origins.some((o) => o.startsWith("http://localhost")), "localhost is trusted in production")
  assert.ok(!origins.some((o) => o.startsWith("http://127.0.0.1")))
})
