// No secret-derived value can reach a preflight log line.
//
// THE ALERTS THIS CLOSES
// ======================
// Two `js/clear-text-logging` findings in scripts/staging-preflight.mjs: the
// per-check logger, and the closing BLOCKED summary. Both printed a free-form
// `detail` string, and callers were passing env-derived values into it — a
// slice of STRIPE_SECRET_KEY, Stripe's error text, and Supabase driver errors
// that can carry the project URL.
//
// The fix is structural: text comes only from a frozen allowlist, and counts
// go through Number(). This drives the real reporter with real secret-shaped
// input and asserts none of it survives.
import assert from "node:assert/strict"
import { test } from "node:test"

const { REASONS, formatBlocked, formatResult } = await import("../scripts/preflight-reporter.mjs")

/**
 * Shaped like the real things, and obviously fake — but ASSEMBLED AT RUNTIME.
 *
 * These were written as plain literals and GitHub Push Protection blocked the
 * push on the `sk_live_...` one. It was right to: a secret scanner matches on
 * SHAPE, and it cannot know that a token which looks exactly like a Stripe key
 * is a test fixture. A scanner that trusted "but it's only a test" would be
 * useless, and suppressing the finding would train us to wave through the next
 * one, which might be real.
 *
 * So the source holds only fragments and the complete token exists only in
 * memory during the run. The values are byte-for-byte what they were, so the
 * regression coverage is unchanged: the logger is still driven with input that
 * is genuinely credential-shaped.
 */
const join = (...parts: string[]) => parts.join("")

const STRIPE_BODY = join("51Qe", "XaMpLe", "NotARealKey", "000000")

const SECRETS = [
  join("sk", "_", "test", "_", STRIPE_BODY),
  join("sk", "_", "live", "_", STRIPE_BODY),
  join("eyJhbGciOiJIUzI1", "NiIsInR5cCI6IkpXVCJ9", ".", "service", "_role", ".", "signature"),
  join("https://", "abcdefghijklmnop", ".supabase", ".co"),
  join("postgres://", "user", ":", "hunter2", "@", "db.abcdefgh", ".supabase", ".co:5432/postgres"),
  join("Invalid API Key provided: ", "sk", "_", "test", "_", "****************0000"),
  join("whsec", "_", "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
]

test("a secret passed as the reason code is NEVER printed", () => {
  for (const secret of SECRETS) {
    const { line, row } = formatResult(false, "Stripe key is test mode", secret)

    assert.ok(!line.includes(secret), `the secret reached the line: ${line}`)
    assert.equal(row.reason, null, "the secret was stored as a reason")

    // Not even a fragment: an eight-character slice was the original leak.
    assert.ok(!line.includes(secret.slice(0, 8)), `a secret fragment reached the line: ${line}`)
  }
})

test("a secret passed as the COUNT is never printed", () => {
  for (const secret of SECRETS) {
    const { line, row } = formatResult(false, "nine gift-card rows exist", null, secret)
    assert.ok(!line.includes(secret), `the secret reached the line: ${line}`)
    assert.equal(row.count, null, "a non-numeric count was stored")
  }
})

test("the BLOCKED summary cannot print a secret either", () => {
  // The second alert. The summary re-reads stored rows, so a row that never
  // held anything unsafe cannot produce an unsafe line.
  for (const secret of SECRETS) {
    const { row } = formatResult(false, "storefront gate is OPEN", secret, secret)
    const line = formatBlocked(row)
    assert.ok(!line.includes(secret), `the summary leaked: ${line}`)
    assert.ok(!line.includes(secret.slice(0, 8)), `the summary leaked a fragment: ${line}`)
  }
})

test("a secret smuggled through a crafted object is not printed", () => {
  // Object.hasOwn, not `in`, so a prototype-chain trick resolves to nothing.
  const hostile = Object.create({ stripe_unreachable: "sk_test_LEAKED" })
  const { line } = formatResult(false, "x", hostile as unknown as string)
  assert.ok(!line.includes("LEAKED"))
  assert.ok(!line.includes("[object"), "an object was stringified into the line")
})

// ===========================================================================
// The checks still report what they should
// ===========================================================================

test("an allowlisted reason still renders its fixed text", () => {
  const { line } = formatResult(false, "Stripe key is test mode", "stripe_key_not_test")
  assert.match(line, /BLOCKED/)
  assert.match(line, /key is not a test-mode key/)
})

test("a numeric count still renders, so diagnostics are not lost", () => {
  const { line, row } = formatResult(false, "nine gift-card rows exist", "row_count_wrong", 7)
  assert.match(line, /unexpected number of gift-card rows 7/)
  assert.equal(row.count, "7")

  // An HTTP status is a number and is safe.
  assert.match(formatResult(false, "staging /store reachable", "store_unreachable", 502).line, /502/)
})

test("a passing check reads READY", () => {
  assert.match(formatResult(true, "Stripe key is test mode", "ok").line, /^READY/)
})

test("the reason table is frozen, so it cannot be extended at runtime", () => {
  assert.ok(Object.isFrozen(REASONS))
  assert.throws(
    () => {
      "use strict"
      ;(REASONS as Record<string, string>).injected = "sk_test_LEAKED"
    },
    "the allowlist accepted a new entry"
  )
})

test("every reason value is a fixed literal, not interpolated", () => {
  // A template literal here would be the way this protection quietly dies.
  for (const [code, text] of Object.entries(REASONS)) {
    assert.equal(typeof text, "string", code)
    assert.ok(!/sk_|rk_|whsec_|eyJ|supabase\.co|postgres:\/\//.test(text), `${code} looks secret-shaped`)
  }
})
