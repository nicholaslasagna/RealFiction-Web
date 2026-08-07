// The LIVE reconciler must never call Stripe for a TEST-mode session id.
//
// THE INCIDENT
// ============
// Stripe Workbench showed ~30 `resource_missing` errors on
// `GET /v1/checkout/sessions/cs_test_...` across three ids in seven days, from
// a Worker configured with `STRIPE_ENVIRONMENT=live` and a live secret key.
//
// Stripe namespaces ids by mode, so a `cs_test_` id under a live key is a
// guaranteed 404. The reconciler could not tell that 404 apart from a timeout —
// correctly, since neither proves an order went unpaid — so it retried on a
// backoff: 1, 2, 4, 8, 16, 32, then 60-minute intervals, ten attempts per row.
// Three rows x ten attempts = the thirty observed calls.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)
mock.module("server-only", { namedExports: {}, defaultExport: {} })

// `mock.module` may be installed only ONCE per specifier, so the client is read
// from a holder each call and swapped per test rather than re-mocked.
const holder: { client: unknown } = { client: null }
mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => holder.client }
})

const { sessionMatchesMode, reconcilePendingStripeOrders, RECONCILE_DEFAULTS } = await import(
  "./store/reconcile-pending.ts"
)

// ===========================================================================
// The pure rule
// ===========================================================================

test("a TEST session id never matches live mode", () => {
  assert.equal(sessionMatchesMode("cs_test_a1b2c3", true), false)
  assert.equal(sessionMatchesMode("cs_test_a1b2c3", false), true)
})

test("a LIVE session id never matches test mode", () => {
  assert.equal(sessionMatchesMode("cs_live_a1b2c3", false), false)
  assert.equal(sessionMatchesMode("cs_live_a1b2c3", true), true)
})

test("an UNRECOGNISED id shape is allowed through, not blocked", () => {
  // An unfamiliar prefix is not evidence of a mismatch. Refusing to look it up
  // would strand a real order on a guess about Stripe's id format.
  for (const id of ["cs_a1b2c3", "sess_123", ""]) {
    assert.equal(sessionMatchesMode(id, true), true, id)
    assert.equal(sessionMatchesMode(id, false), true, id)
  }
})

// ===========================================================================
// The reconciler, driven for real
// ===========================================================================

function harness(sessionId: string, liveMode: boolean) {
  const calls = { stripe: [] as string[], finish: [] as Record<string, unknown>[], fulfil: 0 }

  const supabase = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "claim_pending_reconciliations") {
        return {
          data: [
            {
              order_id: "11111111-1111-4111-8111-111111111111",
              provider_session_id: sessionId,
              expected_amount_cents: 500,
              expected_currency: "USD",
              attempts: 1
            }
          ],
          error: null
        }
      }
      if (fn === "finish_pending_reconciliation") {
        calls.finish.push(args)
        return { data: [{ disposition: args.p_disposition, review: args.p_disposition === "review" }], error: null }
      }
      return { data: null, error: null }
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) })
  }

  const fetchImpl = (async (url: unknown) => {
    calls.stripe.push(String(url))
    // What Stripe really answers for a cross-mode id.
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: { code: "resource_missing", type: "invalid_request_error" } })
    }
  }) as unknown as typeof fetch

  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-not-real",
    STRIPE_SECRET_KEY: "sk_live_not_a_real_key",
    STRIPE_ENVIRONMENT: liveMode ? "live" : "test"
  }

  return { calls, supabase, fetchImpl, env }
}

test("LIVE + cs_test_ makes NO Stripe call at all", async () => {
  const h = harness("cs_test_stale_from_may", true)
  holder.client = h.supabase
  const run = reconcilePendingStripeOrders
  const result = await run(h.env, { fetchImpl: h.fetchImpl, fulfil: async () => { h.calls.fulfil++ } })

  assert.deepEqual(h.calls.stripe, [], "the reconciler called Stripe for a test-mode id")
  assert.equal(h.calls.fulfil, 0, "nothing was fulfilled")
  assert.equal(result.review, 1, "the row was not routed to review")
})

test("the mismatched row goes to REVIEW, so it stops after ONE attempt", async () => {
  const h = harness("cs_test_stale_from_may", true)
  holder.client = h.supabase
  const run = reconcilePendingStripeOrders
  await run(h.env, { fetchImpl: h.fetchImpl, fulfil: async () => {} })

  const finish = h.calls.finish[0]
  assert.equal(finish.p_disposition, "review", "must not be retried")
  assert.equal(finish.p_outcome, "mismatch_review")

  // Review sets reconciliation_review_required, which the claim predicate
  // excludes — so this row can never generate another Stripe call.
  assert.notEqual(finish.p_disposition, "retry")
})

test("a MATCHING live id still reaches Stripe — the guard is not a blanket block", async () => {
  const h = harness("cs_live_real_session", true)
  holder.client = h.supabase
  const run = reconcilePendingStripeOrders
  await run(h.env, { fetchImpl: h.fetchImpl, fulfil: async () => {} })

  assert.equal(h.calls.stripe.length, 1, "a legitimate live session was not retrieved")
  assert.match(h.calls.stripe[0], /cs_live_real_session/)

  // A genuine 404 on a mode-MATCHING id is still "we don't know" -> retry.
  assert.equal(h.calls.finish[0].p_disposition, "retry")
})

test("the retry ceiling that produced the 30 calls is unchanged", () => {
  // 3 stale rows x 10 attempts = the 30 observed occurrences.
  assert.equal(RECONCILE_DEFAULTS.maxAttempts, 10)
})
