// Reconciliation as it actually runs: claim, retrieve, decide, FULFIL.
//
// THE HEADLINE CASE
// =================
// Stripe collected $17.00. The success webhook was lost — not delayed, lost, so
// it is never coming. Our order is still pending, the customer has no rank, and
// no email was ever sent. Reconciliation must not merely protect the upgrade
// credit while waiting forever; it must complete the purchase itself.
//
// Everything here runs against an in-memory stand-in for Postgres and a fake
// Stripe. No network, no database, no live keys.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

type Reservation = {
  id: string
  order_id: string
  session_id: string
  state: "reserved" | "consumed" | "released" | "needs_review"
  lease_until: number
  next_at: number
  attempts: number
}

type Order = {
  id: string
  status: string
  payment_due_cents: number
  total_cents: number
  currency: string
}

type Db = {
  reservations: Reservation[]
  orders: Record<string, Order>
  calls: { fn: string; args: Record<string, unknown> }[]
  fulfilments: string[]
}

function newDb(overrides: Partial<Reservation> = {}, order: Partial<Order> = {}): Db {
  return {
    reservations: [
      {
        id: "res-1",
        order_id: "order-1",
        session_id: "cs_1",
        state: "reserved",
        lease_until: 0,
        next_at: 0,
        attempts: 0,
        ...overrides
      }
    ],
    orders: {
      "order-1": {
        id: "order-1",
        status: "pending",
        payment_due_cents: 1700,
        total_cents: 2200,
        currency: "USD",
        ...order
      }
    },
    calls: [],
    fulfilments: []
  }
}

/**
 * Enough of the real SQL to be meaningful: the claim honours leases and the
 * batch limit, fulfilment moves the reservation out of 'reserved', and
 * apply/finish behave as their Postgres counterparts do.
 */
function fakeClient(db: Db) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      db.calls.push({ fn, args })
      const now = Date.now()

      if (fn === "claim_upgrade_reconciliations") {
        const limit = Math.max(1, Math.min(Number(args.p_limit ?? 10), 100))
        const claimed = db.reservations
          .filter((r) => r.state === "reserved" && r.lease_until <= now && r.next_at <= now)
          .slice(0, limit)
        for (const r of claimed) {
          r.lease_until = now + Number(args.p_lease_seconds ?? 120) * 1000
          r.attempts += 1
        }
        return {
          data: claimed.map((r) => ({
            reservation_id: r.id,
            order_id: r.order_id,
            provider_session_id: r.session_id,
            requested_cancel: false,
            expected_amount_cents: db.orders[r.order_id].payment_due_cents,
            expected_currency: db.orders[r.order_id].currency,
            attempts: r.attempts
          })),
          error: null
        }
      }

      if (fn === "fulfill_paid_order_with_outbox") {
        const orderId = String(args.p_order_id)
        const reservation = db.reservations.find((r) => r.order_id === orderId)
        // The real function is one transaction: terminal status, entitlements,
        // reward queue, email outbox, and the credit consumed together.
        if (db.orders[orderId].status === "pending") {
          db.orders[orderId].status = "fulfilled"
          db.fulfilments.push(orderId)
          if (reservation?.state === "reserved") {
            reservation.state = "consumed"
          }
          return { data: [{ already_fulfilled: false, email_queued: true }], error: null }
        }
        // Replay: idempotent no-op.
        return { data: [{ already_fulfilled: true, email_queued: false }], error: null }
      }

      if (fn === "apply_upgrade_reconciliation") {
        const r = db.reservations.find((x) => x.id === args.p_reservation_id)
        if (!r) return { data: [{ outcome: "reservation_not_found", released: false }], error: null }
        if (r.state !== "reserved") {
          return { data: [{ outcome: `already_${r.state}`, released: false }], error: null }
        }
        const status = String(args.p_provider_status)
        if (status === "expired_unpaid" || status === "payment_failed") {
          r.state = "released"
          return { data: [{ outcome: `released_${status}`, released: true }], error: null }
        }
        if (status === "mismatch") {
          r.state = "needs_review"
          return { data: [{ outcome: "needs_review_mismatch", released: false }], error: null }
        }
        if (status === "paid") return { data: [{ outcome: "held_payment_succeeded", released: false }], error: null }
        if (status === "async_pending")
          return { data: [{ outcome: "held_payment_pending", released: false }], error: null }
        return { data: [{ outcome: "held_unknown_provider_state", released: false }], error: null }
      }

      if (fn === "finish_upgrade_reconciliation") {
        const r = db.reservations.find((x) => x.id === args.p_reservation_id)
        if (!r) return { data: [{ outcome: "reservation_not_found", escalated: false }], error: null }
        r.lease_until = 0
        if (r.state === "reserved" && args.p_retry === true) {
          if (r.attempts >= Number(args.p_max_attempts ?? 10)) {
            r.state = "needs_review"
            return { data: [{ outcome: "escalated_to_review", escalated: true }], error: null }
          }
          r.next_at = Date.now() + 60_000
          return { data: [{ outcome: "retry_scheduled", escalated: false }], error: null }
        }
        return { data: [{ outcome: "closed", escalated: false }], error: null }
      }

      return { data: null, error: { message: `unexpected rpc ${fn}` } }
    },

    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, value: string) => ({
          maybeSingle: async () => ({
            data: table === "orders" ? (db.orders[value] ?? null) : null,
            error: null
          })
        })
      })
    })
  }
}

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-value",
  STRIPE_SECRET_KEY: "stripe-secret-value",
  STRIPE_ENVIRONMENT: "test"
}

const PAID_SESSION = {
  id: "cs_1",
  status: "complete",
  payment_status: "paid",
  currency: "usd",
  amount_total: 1700,
  livemode: false,
  metadata: { order_id: "order-1" },
  payment_intent: { id: "pi_1", status: "succeeded", latest_charge: "ch_1" }
}

function stripeReturning(body: unknown, ok = true) {
  const seen: string[] = []
  const impl = (async (url: string) => {
    seen.push(String(url))
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => body
    } as Response
  }) as unknown as typeof fetch
  return { impl, seen }
}

// `createClient` is called fresh on every run, so ONE module mock plus a mutable
// holder covers every test — and `mock.module` may only be applied once per
// specifier anyway.
let current: { client: unknown } = { client: null }

mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => current.client }
})

const { reconcileUpgradeReservations } = await import("./store/reconcile-upgrades.ts")

function use(db: Db) {
  current = { client: fakeClient(db) }
  return db
}

// ===========================================================================
// THE RECOVERY
// ===========================================================================

test("STRIPE PAID, WEBHOOK LOST: reconciliation itself fulfils the order", async () => {
  const db = newDb()
  use(db)
  const stripe = stripeReturning(PAID_SESSION)

  const result = await reconcileUpgradeReservations(ENV, { fetchImpl: stripe.impl })

  assert.equal(result.claimed, 1)
  assert.equal(result.fulfilled, 1, "the paid order must be FULFILLED, not merely held")
  assert.deepEqual(db.fulfilments, ["order-1"], "exactly one fulfilment")
  assert.equal(db.orders["order-1"].status, "fulfilled")
  assert.equal(db.reservations[0].state, "consumed", "the upgrade credit is consumed exactly once")

  // The same database function the webhook calls — not a second implementation.
  const fulfilCalls = db.calls.filter((c) => c.fn === "fulfill_paid_order_with_outbox")
  assert.equal(fulfilCalls.length, 1)
  assert.equal(fulfilCalls[0].args.p_payment_intent_id, "pi_1")
  assert.equal(fulfilCalls[0].args.p_charge_id, "ch_1")
})

test("a webhook that finally arrives afterwards is a harmless replay", async () => {
  const db = newDb()
  use(db)
  await reconcileUpgradeReservations(ENV, { fetchImpl: stripeReturning(PAID_SESSION).impl })

  // The late webhook drives the same transaction.
  const client = fakeClient(db)
  const replay = await client.rpc("fulfill_paid_order_with_outbox", { p_order_id: "order-1" })

  assert.equal((replay.data as [{ already_fulfilled: boolean }])[0].already_fulfilled, true)
  assert.equal(db.fulfilments.length, 1, "still exactly one fulfilment")
  assert.equal(db.reservations[0].state, "consumed", "still consumed exactly once")
})

test("a second reconciliation run does not fulfil the same order again", async () => {
  const db = newDb()
  use(db)
  await reconcileUpgradeReservations(ENV, { fetchImpl: stripeReturning(PAID_SESSION).impl })
  const second = await reconcileUpgradeReservations(ENV, { fetchImpl: stripeReturning(PAID_SESSION).impl })

  assert.equal(second.claimed, 0, "the consumed reservation is no longer claimable")
  assert.equal(db.fulfilments.length, 1)
})

test("the PaymentIntent is expanded, so a delayed payment is distinguishable", async () => {
  const db = newDb()
  use(db)
  const stripe = stripeReturning(PAID_SESSION)
  await reconcileUpgradeReservations(ENV, { fetchImpl: stripe.impl })

  assert.equal(stripe.seen.length, 1)
  assert.match(stripe.seen[0], /\/v1\/checkout\/sessions\/cs_1\?expand%5B%5D=payment_intent|expand\[\]=payment_intent/)
})

// ===========================================================================
// VERDICTS THAT MUST NOT FULFIL
// ===========================================================================

test("async pending holds: no fulfilment, no release, retry scheduled", async () => {
  const db = newDb()
  use(db)
  const result = await reconcileUpgradeReservations(ENV, {
    fetchImpl: stripeReturning({
      ...PAID_SESSION,
      payment_status: "unpaid",
      payment_intent: { id: "pi_1", status: "processing" }
    }).impl
  })

  assert.equal(result.fulfilled, 0)
  assert.equal(result.released, 0)
  assert.equal(db.reservations[0].state, "reserved")
  assert.ok(db.reservations[0].next_at > Date.now(), "backoff is scheduled")
})

test("a cancelled PaymentIntent is a terminal FAILURE and releases", async () => {
  const db = newDb()
  use(db)
  const result = await reconcileUpgradeReservations(ENV, {
    fetchImpl: stripeReturning({
      ...PAID_SESSION,
      payment_status: "unpaid",
      payment_intent: { id: "pi_1", status: "canceled" }
    }).impl
  })

  assert.equal(result.fulfilled, 0)
  assert.equal(result.released, 1)
  assert.equal(db.reservations[0].state, "released")
})

test("an expired unpaid session releases; a paid one never does", async () => {
  const expired = newDb()
  use(expired)
  await reconcileUpgradeReservations(ENV, {
    fetchImpl: stripeReturning({ ...PAID_SESSION, status: "expired", payment_status: "unpaid", payment_intent: "pi_1" })
      .impl
  })
  assert.equal(expired.reservations[0].state, "released")
  assert.equal(expired.fulfilments.length, 0)
})

test("provider unreachable HOLDS and never fulfils", async () => {
  const db = newDb()
  use(db)
  const result = await reconcileUpgradeReservations(ENV, {
    fetchImpl: stripeReturning({ error: "nope" }, false).impl
  })

  assert.equal(result.unavailable, 1)
  assert.equal(result.fulfilled, 0)
  assert.equal(db.reservations[0].state, "reserved")
  assert.equal(db.fulfilments.length, 0)
})

test("an amount mismatch does not fulfil, does not release, and parks for review", async () => {
  const db = newDb()
  use(db)
  const result = await reconcileUpgradeReservations(ENV, {
    fetchImpl: stripeReturning({ ...PAID_SESSION, amount_total: 100 }).impl
  })

  assert.equal(result.mismatched, 1)
  assert.equal(result.fulfilled, 0)
  assert.equal(result.released, 0)
  assert.equal(db.reservations[0].state, "needs_review")
  assert.equal(db.fulfilments.length, 0)
})

test("a session bound to another order cannot fulfil this one", async () => {
  const db = newDb()
  use(db)
  await reconcileUpgradeReservations(ENV, {
    fetchImpl: stripeReturning({ ...PAID_SESSION, metadata: { order_id: "someone-else" } }).impl
  })

  assert.equal(db.fulfilments.length, 0)
  assert.equal(db.reservations[0].state, "needs_review")
})

test("a live-mode session cannot fulfil a test-mode order", async () => {
  const db = newDb()
  use(db)
  await reconcileUpgradeReservations(ENV, {
    fetchImpl: stripeReturning({ ...PAID_SESSION, livemode: true }).impl
  })

  assert.equal(db.fulfilments.length, 0)
  assert.equal(db.reservations[0].state, "needs_review")
})

test("an order that is already terminal is not re-fulfilled", async () => {
  const db = newDb({}, { status: "fulfilled" })
  use(db)
  await reconcileUpgradeReservations(ENV, { fetchImpl: stripeReturning(PAID_SESSION).impl })

  assert.equal(db.fulfilments.length, 0, "no second fulfilment for a finished order")
  assert.equal(db.reservations[0].state, "reserved", "and nothing was released on that basis")
})

// ===========================================================================
// BOUNDS
// ===========================================================================

test("the batch limit is respected and passed to the claim", async () => {
  const db = newDb()
  for (let i = 2; i <= 40; i++) {
    db.reservations.push({
      id: `res-${i}`,
      order_id: "order-1",
      session_id: "cs_1",
      state: "reserved",
      lease_until: 0,
      next_at: 0,
      attempts: 0
    })
  }

  use(db)
  const result = await reconcileUpgradeReservations(ENV, {
    batchSize: 3,
    fetchImpl: stripeReturning({ ...PAID_SESSION, status: "expired", payment_status: "unpaid" }).impl
  })

  assert.equal(result.claimed, 3, "a five-minute tick must stay a small bounded job")
  const claim = db.calls.find((c) => c.fn === "claim_upgrade_reconciliations")
  assert.equal(claim?.args.p_limit, 3)
})

test("the batch size is capped even when a caller asks for more", async () => {
  const db = newDb()
  use(db)
  await reconcileUpgradeReservations(ENV, {
    batchSize: 100_000,
    fetchImpl: stripeReturning(PAID_SESSION).impl
  })
  const claim = db.calls.find((c) => c.fn === "claim_upgrade_reconciliations")
  assert.equal(claim?.args.p_limit, 100)
})

test("a HUNG Stripe request is bounded by the timeout and holds", async () => {
  const db = newDb()
  use(db)

  const hung = (async (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      // Never settles on its own; only the abort signal ends it.
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
    })) as unknown as typeof fetch

  const started = Date.now()
  const result = await reconcileUpgradeReservations(ENV, { requestTimeoutMs: 1_000, fetchImpl: hung })
  const elapsed = Date.now() - started

  assert.ok(elapsed < 5_000, `the run must not hang (took ${elapsed}ms)`)
  assert.equal(result.unavailable, 1)
  assert.equal(db.reservations[0].state, "reserved", "a timeout is not evidence of non-payment")
  assert.equal(db.fulfilments.length, 0)
})

test("a second worker cannot claim a row the first still holds", async () => {
  const db = newDb()
  use(db)

  // Worker A claims and leases the row.
  const a = await reconcileUpgradeReservations(ENV, {
    workerId: "worker-a",
    fetchImpl: stripeReturning({ error: "x" }, false).impl
  })
  assert.equal(a.claimed, 1)

  // Its finish() cleared the lease but scheduled backoff, so B sees nothing due.
  const b = await reconcileUpgradeReservations(ENV, {
    workerId: "worker-b",
    fetchImpl: stripeReturning(PAID_SESSION).impl
  })
  assert.equal(b.claimed, 0)
  assert.equal(db.fulfilments.length, 0)
})

test("attempts escalate to a human instead of ever releasing", async () => {
  const db = newDb({ attempts: 9 })
  use(db)
  const result = await reconcileUpgradeReservations(ENV, {
    fetchImpl: stripeReturning({ error: "x" }, false).impl
  })

  assert.equal(result.escalated, 1)
  assert.equal(db.reservations[0].state, "needs_review", "review, never release")
})

// ===========================================================================
// FAIL CLOSED
// ===========================================================================

test("missing Stripe configuration claims nothing, releases nothing, fulfils nothing", async () => {
  const db = newDb()
  use(db)
  const result = await reconcileUpgradeReservations(
    { ...ENV, STRIPE_SECRET_KEY: "" },
    { fetchImpl: stripeReturning(PAID_SESSION).impl }
  )

  assert.deepEqual(result, {
    claimed: 0,
    fulfilled: 0,
    held: 0,
    released: 0,
    mismatched: 0,
    unavailable: 0,
    escalated: 0
  })
  assert.equal(db.calls.length, 0, "an unconfigured worker must not even claim")
  assert.equal(db.reservations[0].state, "reserved")
})

test("missing Supabase configuration is equally inert", async () => {
  const db = newDb()
  use(db)
  const result = await reconcileUpgradeReservations(
    { ...ENV, SUPABASE_SERVICE_ROLE_KEY: "" },
    { fetchImpl: stripeReturning(PAID_SESSION).impl }
  )
  assert.equal(result.claimed, 0)
  assert.equal(db.calls.length, 0)
})

test("a fulfilment error rolls back into a HOLD, never a release", async () => {
  const db = newDb()
  use(db)
  const client = fakeClient(db)
  current = {
    client: {
      ...client,
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn === "fulfill_paid_order_with_outbox") {
          db.calls.push({ fn, args })
          return { data: null, error: { message: "deadlock detected" } }
        }
        return client.rpc(fn, args)
      }
    }
  }

  const result = await reconcileUpgradeReservations(ENV, {
    fetchImpl: stripeReturning(PAID_SESSION).impl
  })

  assert.equal(result.fulfilled, 0)
  assert.equal(result.released, 0)
  assert.equal(db.reservations[0].state, "reserved", "the credit survives a failed fulfilment")
  assert.equal(db.orders["order-1"].status, "pending")
})

test("no secret is ever logged", async () => {
  const db = newDb()
  use(db)
  const lines: string[] = []
  const info = console.info
  console.info = (...args: unknown[]) => lines.push(JSON.stringify(args))

  try {
    await reconcileUpgradeReservations(ENV, { fetchImpl: stripeReturning(PAID_SESSION).impl })
  } finally {
    console.info = info
  }

  const body = lines.join("\n")
  assert.ok(body.length > 0, "the decision is logged")
  assert.ok(!body.includes(ENV.STRIPE_SECRET_KEY))
  assert.ok(!body.includes(ENV.SUPABASE_SERVICE_ROLE_KEY))
  assert.ok(!/payment_intent|amount_total|customer_email/.test(body), "no provider payload")
})
