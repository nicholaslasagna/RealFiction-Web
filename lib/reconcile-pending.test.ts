// Generic pending-order reconciliation: classification, bounds, and isolation.
//
// The classifier decides whether a customer who may already have paid keeps
// their reservation, so every branch is asserted directly. The run-level tests
// use an in-memory stand-in for the claim/finish RPCs; the real-Postgres proofs
// live in lib/reconcile-lost-webhook.test.ts.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

mock.module("server-only", { namedExports: {}, defaultExport: {} })

let currentClient: unknown = null
mock.module("@supabase/supabase-js", { namedExports: { createClient: () => currentClient } })

const { classifyPendingSession, reconcilePendingStripeOrders, RECONCILE_DEFAULTS } = await import(
  "./store/reconcile-pending.ts"
)

const EXPECTED = {
  orderId: "order-1",
  sessionId: "cs_1",
  amountCents: 1299,
  currency: "USD",
  liveMode: true
}

const BASE = {
  id: "cs_1",
  livemode: true,
  currency: "usd",
  amount_total: 1299,
  metadata: { order_id: "order-1" }
}

// ===========================================================================
// Classification
// ===========================================================================

test("a paid session is the recovery case", () => {
  assert.equal(
    classifyPendingSession({ ...BASE, status: "complete", payment_status: "paid" }, EXPECTED),
    "paid_fulfilled"
  )
})

test("a succeeded PaymentIntent counts as paid even if the session lags", () => {
  assert.equal(
    classifyPendingSession(
      { ...BASE, status: "complete", payment_status: "unpaid", payment_intent: { id: "pi_1", status: "succeeded" } },
      EXPECTED
    ),
    "paid_fulfilled"
  )
})

test("complete-but-unsettled is async pending, never released", () => {
  assert.equal(
    classifyPendingSession({ ...BASE, status: "complete", payment_status: "unpaid" }, EXPECTED),
    "async_pending"
  )
  assert.equal(
    classifyPendingSession(
      { ...BASE, status: "complete", payment_status: "unpaid", payment_intent: { id: "pi_1", status: "processing" } },
      EXPECTED
    ),
    "async_pending"
  )
})

test("an open unpaid session is still payable and is only retried", () => {
  assert.equal(
    classifyPendingSession({ ...BASE, status: "open", payment_status: "unpaid" }, EXPECTED),
    "open_unpaid"
  )
})

test("EXPIRED AND UNPAID is the only branch that may cancel", () => {
  assert.equal(
    classifyPendingSession({ ...BASE, status: "expired", payment_status: "unpaid" }, EXPECTED),
    "expired_unpaid_cancelled"
  )
})

test("a canceled PaymentIntent is a terminal failure", () => {
  assert.equal(
    classifyPendingSession(
      { ...BASE, status: "open", payment_status: "unpaid", payment_intent: { id: "pi_1", status: "canceled" } },
      EXPECTED
    ),
    "payment_failed_cancelled"
  )
})

test("an unreachable, missing, or malformed provider response HOLDS", () => {
  assert.equal(classifyPendingSession(null, EXPECTED), "provider_unavailable")
  assert.equal(classifyPendingSession({}, EXPECTED), "provider_unavailable")
  assert.equal(
    classifyPendingSession({ ...BASE, status: "something_new", payment_status: "weird" }, EXPECTED),
    "provider_unavailable"
  )
})

// -- Mismatches: never fulfil, never release --------------------------------

test("a session bound to ANOTHER order goes to review", () => {
  assert.equal(
    classifyPendingSession({ ...BASE, metadata: { order_id: "someone-else" }, status: "expired" }, EXPECTED),
    "mismatch_review"
  )
})

test("a swapped session id goes to review", () => {
  assert.equal(classifyPendingSession({ ...BASE, id: "cs_other", status: "expired" }, EXPECTED), "mismatch_review")
})

test("client_reference_id is accepted as the binding when metadata is absent", () => {
  assert.equal(
    classifyPendingSession(
      { id: "cs_1", livemode: true, currency: "usd", amount_total: 1299, client_reference_id: "order-1", status: "complete", payment_status: "paid" },
      EXPECTED
    ),
    "paid_fulfilled"
  )
})

test("wrong environment, currency, or amount all go to review", () => {
  for (const session of [
    { ...BASE, livemode: false, status: "complete", payment_status: "paid" },
    { ...BASE, currency: "eur", status: "complete", payment_status: "paid" },
    { ...BASE, amount_total: 100, status: "complete", payment_status: "paid" }
  ]) {
    assert.equal(classifyPendingSession(session, EXPECTED), "mismatch_review")
  }
})

test("NO mismatch can ever produce a cancelling verdict", () => {
  const cancelling = new Set(["expired_unpaid_cancelled", "payment_failed_cancelled"])
  for (const session of [
    { ...BASE, metadata: { order_id: "other" }, status: "expired", payment_status: "unpaid" },
    { ...BASE, livemode: false, status: "expired", payment_status: "unpaid" },
    { ...BASE, currency: "gbp", status: "expired", payment_status: "unpaid" },
    { ...BASE, amount_total: 1, status: "expired", payment_status: "unpaid" },
    { ...BASE, id: "cs_wrong", status: "expired", payment_status: "unpaid" }
  ]) {
    assert.ok(
      !cancelling.has(classifyPendingSession(session, EXPECTED)),
      "a mismatched session must never release a reservation"
    )
  }
})

// ===========================================================================
// Run behaviour
// ===========================================================================

type Order = { id: string; status: string; payment_due_cents: number; currency: string; session: string }

function fakeDb(order: Partial<Order> = {}) {
  const state = {
    order: {
      id: "order-1",
      status: "pending",
      payment_due_cents: 1299,
      currency: "USD",
      session: "cs_1",
      ...order
    } as Order,
    calls: [] as { fn: string; args: Record<string, unknown> }[],
    claimable: true,
    cancelled: 0
  }

  currentClient = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push({ fn, args })
      if (fn === "claim_pending_reconciliations") {
        if (!state.claimable) return { data: [], error: null }
        state.claimable = false
        return {
          data: [
            {
              order_id: state.order.id,
              provider_session_id: state.order.session,
              expected_amount_cents: state.order.payment_due_cents,
              expected_currency: state.order.currency,
              attempts: 1
            }
          ],
          error: null
        }
      }
      if (fn === "cancel_reconciled_unpaid_order") {
        state.cancelled++
        return { data: [{ cancelled: true, released_cents: 0 }], error: null }
      }
      if (fn === "finish_pending_reconciliation") {
        return {
          data: [
            {
              disposition: args.p_disposition,
              review: args.p_disposition === "review",
              next_at: null
            }
          ],
          error: null
        }
      }
      return { data: null, error: null }
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: state.order.id,
              status: state.order.status,
              payment_due_cents: state.order.payment_due_cents,
              total_cents: state.order.payment_due_cents,
              currency: state.order.currency,
              provider_session_id: state.order.session
            }
          })
        })
      })
    })
  }
  return state
}

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-value",
  STRIPE_SECRET_KEY: "stripe-secret-value",
  STRIPE_ENVIRONMENT: "live"
}

function stripeReturning(body: unknown, ok = true) {
  const seen: string[] = []
  const impl = (async (url: string) => {
    seen.push(String(url))
    return { ok, status: ok ? 200 : 500, json: async () => body } as Response
  }) as unknown as typeof fetch
  return { impl, seen }
}

const PAID = { ...BASE, status: "complete", payment_status: "paid", payment_intent: { id: "pi_1", status: "succeeded", latest_charge: "ch_1" } }

test("a paid session calls the SHARED fulfilment dispatch exactly once", async () => {
  const db = fakeDb()
  const fulfilled: string[] = []

  const result = await reconcilePendingStripeOrders(ENV, {
    fetchImpl: stripeReturning(PAID).impl,
    fulfil: async (orderId) => {
      fulfilled.push(orderId)
    }
  })

  assert.equal(result.selected, 1)
  assert.equal(result.fulfilled, 1)
  assert.deepEqual(fulfilled, ["order-1"])
  const finish = db.calls.find((c) => c.fn === "finish_pending_reconciliation")
  assert.equal(finish?.args.p_disposition, "resolved")
  assert.equal(finish?.args.p_outcome, "paid_fulfilled")
})

test("the PaymentIntent is expanded so a delayed payment is distinguishable", async () => {
  fakeDb()
  const stripe = stripeReturning(PAID)
  await reconcilePendingStripeOrders(ENV, { fetchImpl: stripe.impl, fulfil: async () => {} })
  assert.match(stripe.seen[0], /expand(%5B%5D|\[\])=payment_intent/)
})

test("an ALREADY FULFILLED order is an idempotent no-op, not a second fulfilment", async () => {
  const db = fakeDb({ status: "fulfilled" })
  const fulfilled: string[] = []

  await reconcilePendingStripeOrders(ENV, {
    fetchImpl: stripeReturning(PAID).impl,
    fulfil: async (orderId) => {
      fulfilled.push(orderId)
    }
  })

  assert.deepEqual(fulfilled, [], "the webhook already did it")
  const finish = db.calls.find((c) => c.fn === "finish_pending_reconciliation")
  assert.equal(finish?.args.p_outcome, "already_fulfilled")
  assert.equal(finish?.args.p_disposition, "resolved")
})

test("an EXPIRED UNPAID session cancels and releases, once", async () => {
  const db = fakeDb()
  const fulfilled: string[] = []

  const result = await reconcilePendingStripeOrders(ENV, {
    fetchImpl: stripeReturning({ ...BASE, status: "expired", payment_status: "unpaid" }).impl,
    fulfil: async (orderId) => {
      fulfilled.push(orderId)
    }
  })

  assert.equal(result.cancelled, 1)
  assert.equal(db.cancelled, 1)
  assert.deepEqual(fulfilled, [], "nothing is fulfilled on an unpaid expiry")
})

test("provider unavailable holds: no fulfil, no cancel, retry scheduled", async () => {
  const db = fakeDb()
  const fulfilled: string[] = []

  const result = await reconcilePendingStripeOrders(ENV, {
    fetchImpl: stripeReturning({ error: "boom" }, false).impl,
    fulfil: async (orderId) => {
      fulfilled.push(orderId)
    }
  })

  assert.equal(result.fulfilled, 0)
  assert.equal(result.cancelled, 0)
  assert.equal(db.cancelled, 0)
  assert.deepEqual(fulfilled, [])
  assert.equal(db.calls.find((c) => c.fn === "finish_pending_reconciliation")?.args.p_disposition, "retry")
})

test("a MISMATCH never fulfils, never cancels, and goes to review", async () => {
  const db = fakeDb()
  const fulfilled: string[] = []

  const result = await reconcilePendingStripeOrders(ENV, {
    fetchImpl: stripeReturning({ ...PAID, amount_total: 100 }).impl,
    fulfil: async (orderId) => {
      fulfilled.push(orderId)
    }
  })

  assert.equal(result.review, 1)
  assert.equal(result.fulfilled, 0)
  assert.equal(db.cancelled, 0)
  assert.deepEqual(fulfilled, [])
  assert.equal(db.calls.find((c) => c.fn === "finish_pending_reconciliation")?.args.p_disposition, "review")
})

test("a THROWN fulfilment holds the order rather than losing it", async () => {
  const db = fakeDb()
  const result = await reconcilePendingStripeOrders(ENV, {
    fetchImpl: stripeReturning(PAID).impl,
    fulfil: async () => {
      throw new Error("deadlock detected")
    }
  })

  assert.equal(result.fulfilled, 0)
  assert.equal(result.failed, 1)
  assert.equal(db.cancelled, 0, "a failed fulfilment must not cancel anything")
  assert.equal(db.calls.find((c) => c.fn === "finish_pending_reconciliation")?.args.p_disposition, "retry")
})

test("a HUNG Stripe request is bounded by the timeout", async () => {
  fakeDb()
  const hung = (async (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
    })) as unknown as typeof fetch

  const started = Date.now()
  const result = await reconcilePendingStripeOrders(ENV, {
    requestTimeoutMs: 800,
    fetchImpl: hung,
    fulfil: async () => {}
  })
  const elapsed = Date.now() - started

  assert.ok(elapsed < 5_000, `the run must not hang (took ${elapsed}ms)`)
  assert.equal(result.fulfilled, 0)
  assert.equal(result.cancelled, 0)
})

test("the batch size is bounded and passed to the claim", async () => {
  const db = fakeDb()
  await reconcilePendingStripeOrders(ENV, {
    batchSize: 100_000,
    fetchImpl: stripeReturning(PAID).impl,
    fulfil: async () => {}
  })
  const claim = db.calls.find((c) => c.fn === "claim_pending_reconciliations")
  assert.equal(claim?.args.p_limit, RECONCILE_DEFAULTS.maxBatch)
  assert.equal(claim?.args.p_min_age_seconds, RECONCILE_DEFAULTS.minAgeSeconds)
})

test("missing configuration claims NOTHING", async () => {
  const db = fakeDb()
  const result = await reconcilePendingStripeOrders(
    { ...ENV, STRIPE_SECRET_KEY: "" },
    { fetchImpl: stripeReturning(PAID).impl, fulfil: async () => {} }
  )
  assert.deepEqual(result, { selected: 0, fulfilled: 0, retried: 0, cancelled: 0, review: 0, failed: 0 })
  assert.deepEqual(db.calls, [], "an unconfigured worker must not even claim")
})

test("logs carry only safe categories — no secrets, no provider payload", async () => {
  fakeDb()
  const lines: string[] = []
  const info = console.info
  console.info = (...args: unknown[]) => lines.push(JSON.stringify(args))

  try {
    await reconcilePendingStripeOrders(ENV, { fetchImpl: stripeReturning(PAID).impl, fulfil: async () => {} })
  } finally {
    console.info = info
  }

  const body = lines.join("\n")
  assert.ok(body.length > 0, "the outcome is logged")
  assert.ok(!body.includes(ENV.STRIPE_SECRET_KEY))
  assert.ok(!body.includes(ENV.SUPABASE_SERVICE_ROLE_KEY))
  assert.ok(!/amount_total|payment_intent|latest_charge|cs_1/.test(body), "no provider payload or session id")
  assert.match(body, /paid_fulfilled/)
})
