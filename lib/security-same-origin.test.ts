// The same-origin boundary for browser-session mutations.
//
// SameSite=Lax already blocks CSRF today. This exists because that is a
// LIBRARY DEFAULT (@supabase/ssr) rather than something this application
// asserts — a dependency upgrade or a cookie set with SameSite=None for an
// embed would silently remove the only control, and defence you cannot audit
// is defence you cannot rely on.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)
mock.module("server-only", { namedExports: {}, defaultExport: {} })

const { allowedOrigins, checkSameOrigin } = await import("./auth/same-origin.ts")

const PROD = { NEXT_PUBLIC_SITE_URL: "https://realfiction.live", NODE_ENV: "production" }

const req = (method: string, origin?: string) =>
  new Request("https://realfiction.live/api/store/checkout", {
    method,
    headers: origin === undefined ? {} : { origin }
  })

test("the CORRECT production origin is allowed", () => {
  assert.deepEqual(checkSameOrigin(req("POST", "https://realfiction.live"), PROD), { ok: true })
})

test("a MALICIOUS origin is denied", () => {
  for (const evil of ["https://evil.example", "http://attacker.test", "https://realfiction.live.evil.example"]) {
    const result = checkSameOrigin(req("POST", evil), PROD)
    assert.equal(result.ok, false, `${evil} was allowed`)
  }
})

test("LOOKALIKE hostnames are denied", () => {
  // These are exactly what a suffix test or an unescaped-dot regex lets through.
  for (const lookalike of [
    "https://evil-realfiction.live",
    "https://realfictionxlive",
    "https://realfiction.live.attacker.com",
    "https://xrealfiction.live",
    "https://realfiction.livex"
  ]) {
    assert.equal(checkSameOrigin(req("POST", lookalike), PROD).ok, false, `${lookalike} was allowed`)
  }
})

test("a SUBDOMAIN is denied — the boundary is the exact origin", () => {
  // Deliberate: a takeover of any subdomain must not become a session mutation.
  for (const sub of ["https://shop.realfiction.live", "https://map.realfiction.live", "https://a.b.realfiction.live"]) {
    assert.equal(checkSameOrigin(req("POST", sub), PROD).ok, false, `${sub} was allowed`)
  }
})

test("a scheme or port mismatch is denied", () => {
  assert.equal(checkSameOrigin(req("POST", "http://realfiction.live"), PROD).ok, false)
  assert.equal(checkSameOrigin(req("POST", "https://realfiction.live:8443"), PROD).ok, false)
})

test("a MALFORMED origin is denied", () => {
  for (const bad of ["not-a-url", "null", "javascript:alert(1)", "//realfiction.live", "https://"]) {
    assert.equal(checkSameOrigin(req("POST", bad), PROD).ok, false, `${bad} was allowed`)
  }
})

test("a MISSING origin is ALLOWED — deliberately, and the session still gates it", () => {
  // No browser mechanism produces a credentialed cross-site mutation without
  // an Origin header, so refusing one blocks no attacker. A non-browser caller
  // can omit it, but has no session cookie and is refused by the route's own
  // auth check. Refusing here would only break legitimate non-browser clients.
  assert.deepEqual(checkSameOrigin(req("POST"), PROD), { ok: true })
})

test("but a PRESENT and wrong origin is still absolute", () => {
  // The rule that carries the security value.
  assert.equal(checkSameOrigin(req("POST", "https://evil.example"), PROD).ok, false)
  // An empty header is indistinguishable from an absent one at the API level,
  // and is treated as missing.
  assert.deepEqual(checkSameOrigin(req("POST", ""), PROD), { ok: true })
})

test("every mutating method is gated", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(checkSameOrigin(req(method, "https://evil.example"), PROD).ok, false, method)
  }
})

test("SAFE methods are NOT gated", () => {
  // A GET cannot change state, and gating reads would break ordinary navigation.
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.deepEqual(checkSameOrigin(req(method, "https://evil.example"), PROD), { ok: true }, method)
  }
})

test("localhost is allowed in development and REFUSED in production", () => {
  assert.equal(checkSameOrigin(req("POST", "http://localhost:3000"), { NODE_ENV: "development" }).ok, true)
  assert.equal(
    checkSameOrigin(req("POST", "http://localhost:3000"), PROD).ok,
    false,
    "a deployed instance accepted a developer machine as an origin"
  )
})

test("a malformed NEXT_PUBLIC_SITE_URL does not widen the boundary", () => {
  const broken = { NEXT_PUBLIC_SITE_URL: "not a url", NODE_ENV: "production" }
  assert.equal(checkSameOrigin(req("POST", "https://evil.example"), broken).ok, false)
  assert.equal(checkSameOrigin(req("POST", "https://realfiction.live"), broken).ok, false)
})

test("the allowlist contains no wildcard or pattern", () => {
  // Structural: an exact string list, never a regex or a suffix test.
  for (const origin of allowedOrigins(PROD)) {
    assert.doesNotMatch(origin, /[*?]/, `${origin} looks like a pattern`)
    assert.equal(new URL(origin).origin, origin, `${origin} is not a bare origin`)
  }
  assert.deepEqual(allowedOrigins(PROD), ["https://realfiction.live"])
})

// ===========================================================================
// The NODE_ENV fail-open (found in the final adversarial review)
// ===========================================================================

test("localhost is REFUSED whenever a real site origin is configured", () => {
  // The condition used to be an OR chain including `NODE_ENV !== "production"`,
  // so any runtime where NODE_ENV was not exactly "production" — unset in a
  // Worker isolate, "prod", "PRODUCTION" — trusted localhost in production.
  for (const nodeEnv of [undefined, "", "prod", "PRODUCTION", "development", "test"]) {
    const env = { NEXT_PUBLIC_SITE_URL: "https://realfiction.live", NODE_ENV: nodeEnv }
    assert.deepEqual(
      allowedOrigins(env),
      ["https://realfiction.live"],
      `NODE_ENV=${JSON.stringify(nodeEnv)} widened the allowlist`
    )
    assert.equal(
      checkSameOrigin(req("POST", "http://localhost:3000"), env).ok,
      false,
      `NODE_ENV=${JSON.stringify(nodeEnv)} accepted localhost against a production site URL`
    )
  }
})

test("localhost still works for genuine local development", () => {
  // No configured origin at all, or a localhost one.
  assert.equal(checkSameOrigin(req("POST", "http://localhost:3000"), {}).ok, true)
  assert.equal(
    checkSameOrigin(req("POST", "http://localhost:3313"), { NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }).ok,
    true
  )
})

test("a malformed site URL trusts NOTHING rather than falling back to localhost", () => {
  // Fail closed: an unparseable NEXT_PUBLIC_SITE_URL must not silently become
  // "allow local origins" on a deployed instance.
  const env = { NEXT_PUBLIC_SITE_URL: "https://  not a url", NODE_ENV: "production" }
  assert.equal(checkSameOrigin(req("POST", "https://realfiction.live"), env).ok, false)
  assert.equal(checkSameOrigin(req("POST", "http://localhost:3000"), env).ok, false)
})
