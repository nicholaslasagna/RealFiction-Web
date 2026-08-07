// POST /api/gift-cards/claim, executed.
//
// This route is where value moves. Every previous pass proved the claim
// TRANSACTION in SQL and left the HTTP surface — authentication, verified
// email, secret handling, rate limiting, and the shape of what a stranger is
// told — completely unexercised. This drives the real exported handler with
// real Request objects.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

/** Test-only key material. Obviously fake, never a real key. */
const PEPPER = "a".repeat(64)
const SECRET = "abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE" // 43 chars, canonical

const state = {
  user: null as { id: string; email: string; email_confirmed_at: string | null } | null,
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  outbox: [] as Record<string, unknown>[],
  outcome: "claimed",
  amountCents: 2500,
  balanceCents: 2500,
  rpcError: null as { code?: string; message: string } | null,
  logs: [] as string[]
}

mock.module("server-only", { namedExports: {}, defaultExport: {} })

mock.module("@/lib/supabase/server", {
  namedExports: { getAuthenticatedUser: async () => state.user }
})

mock.module("@/lib/supabase/service-role", {
  namedExports: {
    getSupabaseServiceRoleClient: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        state.rpcCalls.push({ fn, args })
        if (state.rpcError) {
          return { data: null, error: state.rpcError }
        }
        return {
          data: [
            {
              outcome: state.outcome,
              amount_cents: state.amountCents,
              gift_card_id: "card-1",
              balance_cents: state.balanceCents
            }
          ],
          error: null
        }
      },
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          state.outbox.push(row)
          return { then: (resolve: (v: unknown) => void) => resolve({ error: null }) }
        }
      })
    })
  }
})

process.env.GIFT_CARD_CLAIM_PEPPER = PEPPER
process.env.GIFT_CARD_ENCRYPTION_KEY = "0".repeat(64)
process.env.GIFT_CARD_ENCRYPTION_KEY_VERSION = "1"

const { POST, GET } = await import("../app/api/gift-cards/claim/route.ts")
const { computeClaimVerifier } = await import("./gift-card/crypto.ts")

let userSeq = 0

function reset(overrides: Partial<typeof state> = {}) {
  // A FRESH account id per test. The route's failure counter is module-level
  // and per-account by design, so reusing one id would let earlier tests'
  // deliberate failures rate-limit later ones.
  state.user = {
    id: `recipient-${++userSeq}`,
    email: "friend@example.com",
    email_confirmed_at: "2026-01-01T00:00:00Z"
  }
  state.rpcCalls = []
  state.outbox = []
  state.outcome = "claimed"
  state.amountCents = 2500
  state.balanceCents = 2500
  state.rpcError = null
  state.logs = []
  Object.assign(state, overrides)
  process.env.GIFT_CARD_CLAIM_PEPPER = PEPPER
}

function post(body: unknown) {
  return POST(
    new Request("https://realfiction.live/api/gift-cards/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body)
    })
  )
}

async function result(response: Response) {
  return (await response.json()) as { result?: string; amountCents?: number; balanceCents?: number }
}

/** Captures everything the route writes to the console for one call. */
async function withCapturedLogs<T>(fn: () => Promise<T>): Promise<{ value: T; logs: string }> {
  const lines: string[] = []
  const original = { info: console.info, warn: console.warn, error: console.error }
  for (const level of ["info", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
    }
  }
  try {
    const value = await fn()
    return { value, logs: lines.join("\n") }
  } finally {
    Object.assign(console, original)
  }
}

// ===========================================================================
// GET never claims
// ===========================================================================

test("GET is a 405 and moves no value", async () => {
  reset()
  const response = await GET()
  assert.equal(response.status, 405)
  assert.equal(response.headers.get("Allow"), "POST")
  assert.deepEqual(state.rpcCalls, [], "GET must not reach the claim transaction")
})

// ===========================================================================
// Authentication and verification
// ===========================================================================

test("a signed-out request is 401 and claims nothing", async () => {
  reset({ user: null })
  const response = await post({ secret: SECRET })
  assert.equal(response.status, 401)
  assert.deepEqual(state.rpcCalls, [])
})

test("an UNVERIFIED email cannot claim", async () => {
  reset()
  state.user = { id: `recipient-${++userSeq}`, email: "friend@example.com", email_confirmed_at: null }
  const response = await post({ secret: SECRET })
  assert.equal((await result(response)).result, "email_not_verified")
  assert.deepEqual(state.rpcCalls, [], "no claim attempt without a verified address")
})

// ===========================================================================
// The secret
// ===========================================================================

test("the verifier is computed SERVER-SIDE from the secret", async () => {
  reset()
  await post({ secret: SECRET })

  const call = state.rpcCalls.find((c) => c.fn === "claim_gift_card")
  assert.ok(call, "the claim transaction ran")
  assert.equal(call.args.p_verifier, await computeClaimVerifier(SECRET, { GIFT_CARD_CLAIM_PEPPER: PEPPER }))
  // The raw secret is never handed to the database.
  assert.ok(!JSON.stringify(call.args).includes(SECRET))
})

test("a client-supplied VERIFIER is ignored — only the secret is read", async () => {
  reset()
  // If the route honoured this, possession of a hash would be enough to claim,
  // which is exactly what the old design got wrong.
  await post({ secret: SECRET, verifier: "f".repeat(64), p_verifier: "f".repeat(64) })

  const call = state.rpcCalls.find((c) => c.fn === "claim_gift_card")
  assert.notEqual(call?.args.p_verifier, "f".repeat(64))
  assert.equal(call?.args.p_verifier, await computeClaimVerifier(SECRET, { GIFT_CARD_CLAIM_PEPPER: PEPPER }))
})

test("missing, malformed, and noncanonical secrets are refused before the HMAC", async () => {
  for (const bad of [
    undefined,
    "",
    "short",
    SECRET.slice(0, 42),
    `${SECRET}A`,
    `${SECRET.slice(0, -1)}+`,
    ` ${SECRET}`,
    12345,
    { nested: SECRET }
  ]) {
    reset()
    const response = await post({ secret: bad })
    assert.equal((await result(response)).result, "invalid_or_unavailable", `accepted ${JSON.stringify(bad)}`)
    assert.deepEqual(state.rpcCalls, [], "a malformed secret must not reach the database")
  }
})

test("a non-JSON body is refused", async () => {
  reset()
  const response = await post("not json at all")
  assert.equal((await result(response)).result, "invalid_or_unavailable")
  assert.deepEqual(state.rpcCalls, [])
})

// ===========================================================================
// Outcomes
// ===========================================================================

test("a valid matching recipient claims, and gets the exact figures back", async () => {
  reset()
  const response = await post({ secret: SECRET })
  const body = await result(response)

  assert.equal(body.result, "claimed")
  assert.equal(body.amountCents, 2500)
  assert.equal(body.balanceCents, 2500)
})

test("the ROUTE does not insert the confirmation — the claim transaction does", async () => {
  // This inverted deliberately. The route used to insert the confirmation
  // AFTER the claim committed, so a failed insert left real credit with no
  // record it had been granted and nothing to retry. `claim_gift_card` now
  // writes the outbox row inside the same transaction (proved in
  // supabase/tests/database/claim_atomicity_and_allocation.test.sql), and a
  // second insert here would produce a duplicate.
  reset()
  const response = await post({ secret: SECRET })

  assert.equal((await result(response)).result, "claimed")
  assert.deepEqual(state.outbox, [], "the route must not write a second confirmation")

  const call = state.rpcCalls.find((c) => c.fn === "claim_gift_card")
  assert.ok(call, "the claim transaction — which owns the outbox row — ran")
})

test("the WRONG recipient is told so, and nothing moves", async () => {
  reset({ outcome: "wrong_recipient" })
  const body = await result(await post({ secret: SECRET }))
  assert.equal(body.result, "wrong_recipient")
  assert.equal(body.amountCents, undefined, "no amount is revealed to a non-recipient")
  assert.equal(state.outbox.length, 0)
})

test("a rotated, voided, refunded, or disputed card is ONE indistinguishable answer", async () => {
  // A stranger holding a guessed secret must not be able to tell a real card in
  // a bad state from no card at all.
  for (const outcome of ["invalid", "already_claimed", "void", "frozen"]) {
    reset({ outcome })
    const body = await result(await post({ secret: SECRET }))
    assert.equal(body.result, "invalid_or_unavailable", `${outcome} leaked a distinguishable result`)
    assert.equal(body.amountCents, undefined)
    assert.equal(state.outbox.length, 0)
  }
})

test("a SAME-ACCOUNT replay is an idempotent success with no new value", async () => {
  reset({ outcome: "already_claimed_by_you", balanceCents: 2500 })
  const body = await result(await post({ secret: SECRET }))

  assert.equal(body.result, "already_claimed_by_you")
  assert.equal(body.balanceCents, 2500)
  assert.equal(state.outbox.length, 0, "no second confirmation email")
})

test("a DIFFERENT account replaying learns nothing", async () => {
  reset({ outcome: "invalid" })
  state.user = { id: `stranger-${++userSeq}`, email: "stranger@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" }
  const body = await result(await post({ secret: SECRET }))

  assert.equal(body.result, "invalid_or_unavailable")
  assert.equal(body.amountCents, undefined)
})

// ===========================================================================
// Failure
// ===========================================================================

test("a missing PEPPER fails closed without touching the database", async () => {
  reset()
  process.env.GIFT_CARD_CLAIM_PEPPER = ""
  const response = await post({ secret: SECRET })

  assert.equal(response.status, 503)
  assert.equal((await result(response)).result, "temporarily_unavailable")
  assert.deepEqual(state.rpcCalls, [])
})

test("a database failure is temporary, not a denial that the card exists", async () => {
  reset({ rpcError: { code: "57014", message: "statement timeout" } })
  const response = await post({ secret: SECRET })

  assert.equal(response.status, 503)
  assert.equal((await result(response)).result, "temporarily_unavailable")
})

test("repeated failures RATE LIMIT the account", async () => {
  reset({ outcome: "invalid" })
  state.user = { id: `rate-${Math.random()}`, email: "rl@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" }

  let limited = false
  for (let attempt = 0; attempt < 15; attempt++) {
    const response = await post({ secret: SECRET })
    if (response.status === 429) {
      limited = true
      assert.equal((await result(response)).result, "rate_limited")
      break
    }
  }
  assert.ok(limited, "guessing must become rate limited")
})

test("a SUCCESSFUL claim is not counted as a failure", async () => {
  reset()
  state.user = { id: `ok-${Math.random()}`, email: "friend@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" }
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await post({ secret: SECRET })
    assert.notEqual(response.status, 429, "valid claims must never be rate limited")
  }
})

// ===========================================================================
// Leakage
// ===========================================================================

test("THE SECRET APPEARS IN NO LOG, on success or on any failure", async () => {
  for (const setup of [
    () => reset(),
    () => reset({ outcome: "invalid" }),
    () => reset({ outcome: "wrong_recipient" }),
    () => reset({ rpcError: { message: `boom ${SECRET}` } })
  ]) {
    setup()
    const { logs } = await withCapturedLogs(() => post({ secret: SECRET }))
    assert.ok(!logs.includes(SECRET), `a log line carried the claim secret: ${logs.slice(0, 120)}`)
    assert.ok(!logs.includes(PEPPER), "a log line carried the pepper")
  }
})

test("the secret appears in no RESPONSE body either", async () => {
  for (const outcome of ["claimed", "invalid", "wrong_recipient"]) {
    reset({ outcome })
    const response = await post({ secret: SECRET })
    const text = await response.text()
    assert.ok(!text.includes(SECRET), `${outcome} response leaked the secret`)
    assert.ok(!/verifier|ciphertext|pepper/i.test(text))
  }
})

test("the response carries no internal identifier", async () => {
  reset()
  const text = await (await post({ secret: SECRET })).text()
  assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  assert.ok(!text.includes("card-1"), "the gift card's database id must not be returned")
})
