// Server-only reconciliation of unresolved Stripe-backed upgrade reservations.
//
// WHAT THIS IS FOR
// ================
// A webhook can be lost. Not delayed — lost. Stripe retries for a while and then
// stops, and if every one of those attempts hit a bad deploy, an expired
// signing secret, or a Cloudflare incident, the money is collected and nothing
// on our side ever hears about it.
//
// Protecting the reservation through that is only half a system. The customer
// paid $17.00 and is owed a rank. So when Stripe confirms a session is paid,
// this does not merely HOLD — it runs the same idempotent fulfilment transaction
// the webhook would have run (`fulfill_paid_order_with_outbox`): grant, include,
// queue the reward, consume the upgrade credit, spend the store credit, reach a
// terminal status, and write the confirmation email outbox row. One transaction.
// A webhook that finally arrives afterwards is a harmless replay.
//
// Postgres cannot call Stripe, so this is the application half of the decision.
// Every state transition still belongs to the database.
//
// Runs from the existing Cloudflare scheduled handler alongside the email queue,
// so no second Cron schedule is needed. Like the email processor it takes an
// EXPLICIT env — `process.env` is not populated in `scheduled()`.
//
// The bias when anything is uncertain is always the same: HOLD. Releasing a
// reservation for a customer who has already paid is the failure we refuse.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import {
  sessionBoundOrderId,
  sessionToFacts,
  verifyPaymentFacts,
  type OrderExpectation
} from "./payment-facts"

export type ReconcileEnv = {
  SUPABASE_URL?: string
  NEXT_PUBLIC_SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_ENVIRONMENT?: string
}

export type ReconcileResult = {
  claimed: number
  /** Paid sessions this run actually fulfilled — the recovery that matters. */
  fulfilled: number
  held: number
  released: number
  mismatched: number
  unavailable: number
  escalated: number
}

/** Verdicts `apply_upgrade_reconciliation` understands. */
export type ProviderVerdict =
  | "paid"
  | "async_pending"
  | "expired_unpaid"
  | "payment_failed"
  | "provider_unreachable"
  | "mismatch"

type SessionShape = {
  id?: string
  status?: string
  payment_status?: string
  currency?: string
  amount_total?: number
  livemode?: boolean
  client_reference_id?: string
  metadata?: Record<string, string>
  payment_intent?: string | { id?: string; status?: string; latest_charge?: unknown }
}

/** Batch and timeout ceilings. A five-minute tick must stay a small, bounded job. */
export const RECONCILE_LIMITS = {
  batchSize: 10,
  /** One Stripe request. A hung socket must not eat the whole invocation. */
  requestTimeoutMs: 8_000,
  /** How long a claimed row is ours. Longer than the worst-case row time. */
  leaseSeconds: 120,
  /** Unresolved passes before a human is asked instead. */
  maxAttempts: 10
} as const

/**
 * Maps a Stripe Checkout Session onto a verdict, after proving the session
 * really belongs to this order.
 *
 * Pure and exported so every branch is unit-testable without network access.
 * A binding, environment, currency, or amount mismatch is NEVER treated as a
 * reason to release — it returns `mismatch`, which parks the row for a human.
 */
export function classifySession(
  session: SessionShape | null,
  expected: {
    orderId: string
    sessionId: string
    expectedAmountCents: number
    expectedCurrency: string
    liveMode: boolean
  }
): ProviderVerdict {
  if (!session || typeof session.id !== "string") {
    return "provider_unreachable"
  }

  // The session must be the one we stored, and must name this order. A session
  // belonging to another order must never drive this order's reconciliation.
  const boundOrder = sessionBoundOrderId(session)
  if (session.id !== expected.sessionId || boundOrder !== expected.orderId) {
    return "mismatch"
  }

  // Test-mode objects must never resolve production state, and vice versa.
  if (typeof session.livemode === "boolean" && session.livemode !== expected.liveMode) {
    return "mismatch"
  }

  if (
    typeof session.currency === "string" &&
    session.currency.toLowerCase() !== expected.expectedCurrency.toLowerCase()
  ) {
    return "mismatch"
  }

  // Amount is only meaningful once Stripe has settled a total.
  if (
    typeof session.amount_total === "number" &&
    session.amount_total !== expected.expectedAmountCents
  ) {
    return "mismatch"
  }

  // The PaymentIntent is the authority on a DELAYED method. A session can sit at
  // `status: complete, payment_status: unpaid` both while an ACH debit is still
  // clearing and after that debit has bounced; only the intent distinguishes
  // them, which is why it is expanded on the request.
  const intent = session.payment_intent
  const intentStatus =
    intent && typeof intent === "object" && typeof intent.status === "string" ? intent.status : null

  if (intentStatus === "canceled") {
    return "payment_failed"
  }

  if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
    return "paid"
  }
  if (intentStatus === "succeeded") {
    return "paid"
  }
  if (intentStatus === "processing" || intentStatus === "requires_action") {
    return "async_pending"
  }

  if (session.status === "expired") {
    // Expired AND never paid. `payment_status` is checked above, so reaching
    // here means Stripe itself says no money was collected.
    return "expired_unpaid"
  }
  if (session.status === "complete") {
    // Complete but not yet `paid` means a delayed method is settling.
    return "async_pending"
  }
  if (session.payment_status === "unpaid" && session.status === "open") {
    return "async_pending"
  }

  // Anything unrecognised holds.
  return "provider_unreachable"
}

function supabaseFor(env: ReconcileEnv): SupabaseClient | null {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  return url && key
    ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    : null
}

function firstRow<T>(data: unknown): T | null {
  return (Array.isArray(data) ? data[0] : data) as T | null
}

type ClaimRow = {
  reservation_id: string
  order_id: string
  provider_session_id: string
  requested_cancel: boolean
  expected_amount_cents: number
  expected_currency: string
  attempts: number
}

/**
 * Reconciles one bounded, claimed batch. Never throws: a reconciliation problem
 * must not surface anywhere near order or payment state, and must not take the
 * email queue down with it.
 */
export async function reconcileUpgradeReservations(
  env: ReconcileEnv,
  options: {
    batchSize?: number
    requestTimeoutMs?: number
    workerId?: string
    fetchImpl?: typeof fetch
  } = {}
): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    claimed: 0,
    fulfilled: 0,
    held: 0,
    released: 0,
    mismatched: 0,
    unavailable: 0,
    escalated: 0
  }

  const supabase = supabaseFor(env)
  const fetchImpl = options.fetchImpl ?? fetch
  const stripeKey = env.STRIPE_SECRET_KEY?.trim()

  // FAIL CLOSED on missing configuration: claim nothing, release nothing,
  // fulfil nothing. An unconfigured Worker is not evidence about any payment.
  if (!supabase || !stripeKey) {
    return result
  }

  const liveMode = (env.STRIPE_ENVIRONMENT ?? "").trim().toLowerCase() === "live"
  const workerId = options.workerId ?? `reconcile-${Date.now()}`
  const timeoutMs = Math.max(1_000, options.requestTimeoutMs ?? RECONCILE_LIMITS.requestTimeoutMs)
  const batchSize = Math.max(1, Math.min(options.batchSize ?? RECONCILE_LIMITS.batchSize, 100))

  let rows: ClaimRow[] = []

  try {
    const { data, error } = await supabase.rpc("claim_upgrade_reconciliations", {
      p_worker: workerId,
      p_limit: batchSize,
      p_lease_seconds: RECONCILE_LIMITS.leaseSeconds
    })
    if (error) {
      return result
    }
    rows = (data ?? []) as ClaimRow[]
  } catch {
    console.error("upgrade_reconciliation_claim_failed")
    return result
  }

  for (const row of rows) {
    result.claimed++
    let verdict: ProviderVerdict = "provider_unreachable"
    let fulfilled = false

    try {
      const session = await retrieveSession(fetchImpl, stripeKey, row.provider_session_id, timeoutMs)

      verdict = classifySession(session, {
        orderId: row.order_id,
        sessionId: row.provider_session_id,
        expectedAmountCents: Number(row.expected_amount_cents),
        expectedCurrency: String(row.expected_currency ?? "USD"),
        liveMode
      })

      if (verdict === "paid" && session) {
        // THE RECOVERY. Stripe has the money and no webhook ever landed, so this
        // run performs the fulfilment itself — through the same transaction the
        // webhook would have called, never a second implementation.
        const expectation = await loadExpectation(supabase, row, liveMode)
        const facts = sessionToFacts(session, row.order_id, new Date().toISOString())

        if (!expectation || !facts) {
          verdict = "provider_unreachable"
        } else {
          const gate = verifyPaymentFacts(facts, expectation)

          if (!gate.ok) {
            // Everything except a terminal order is a genuine contradiction. An
            // order that is already fulfilled simply means someone beat us to it.
            verdict = gate.reason.startsWith("order_not_fulfillable") ? "paid" : "mismatch"
          } else {
            const { error } = await supabase.rpc("fulfill_paid_order_with_outbox", {
              p_order_id: row.order_id,
              p_payment_intent_id: facts.paymentIntentId,
              p_charge_id: facts.chargeId,
              p_receipt_url: null
            })

            if (error) {
              // Fulfilment failed and rolled back: the reservation is still
              // reserved and the order is still pending. Hold and retry.
              verdict = "provider_unreachable"
            } else {
              fulfilled = true
              result.fulfilled++
            }
          }
        }
      }
    } catch {
      verdict = "provider_unreachable"
    }

    // Record the verdict for audit. After a successful fulfilment the row is no
    // longer 'reserved', so this reports `already_consumed` — which is precisely
    // the idempotency that makes racing a webhook safe.
    let outcome = "unknown"
    try {
      const { data } = await supabase.rpc("apply_upgrade_reconciliation", {
        p_reservation_id: row.reservation_id,
        p_provider_status: verdict,
        p_provider_session_id: row.provider_session_id
      })
      outcome = String(firstRow<{ outcome?: string }>(data)?.outcome ?? "unknown")
    } catch {
      outcome = "apply_failed"
    }

    // A mismatch is already parked for a human; retrying cannot resolve a
    // contradiction. Everything else that is still unresolved backs off.
    const retryable = verdict !== "mismatch" && !fulfilled

    try {
      const { data } = await supabase.rpc("finish_upgrade_reconciliation", {
        p_reservation_id: row.reservation_id,
        p_outcome: `${verdict}:${outcome}`,
        p_retry: retryable,
        p_max_attempts: RECONCILE_LIMITS.maxAttempts
      })
      if (firstRow<{ escalated?: boolean }>(data)?.escalated === true) {
        result.escalated++
      }
    } catch {
      // The lease expires on its own; a failed cleanup is not a payment problem.
      console.error("upgrade_reconciliation_finish_failed")
    }

    if (outcome.startsWith("released_")) {
      result.released++
    } else if (verdict === "mismatch") {
      result.mismatched++
    } else if (verdict === "provider_unreachable") {
      result.unavailable++
    } else if (!fulfilled) {
      result.held++
    }

    // The decision only — never the session payload, the customer, or the key.
    console.info("upgrade_reconciled", {
      reservation_id: row.reservation_id,
      verdict,
      outcome,
      fulfilled
    })
  }

  return result
}

/**
 * Retrieves the session, with the PaymentIntent expanded so a delayed payment
 * can be told apart from a failed one, under a hard timeout.
 *
 * Returns null on any non-2xx, network error, or timeout. A missing session is
 * NOT evidence that it went unpaid.
 */
async function retrieveSession(
  fetchImpl: typeof fetch,
  stripeKey: string,
  sessionId: string,
  timeoutMs: number
): Promise<SessionShape | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent`,
      { headers: { Authorization: `Bearer ${stripeKey}` }, signal: controller.signal }
    )
    if (!response.ok) {
      return null
    }
    return (await response.json()) as SessionShape
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** OUR record of the order. Every expected amount comes from here, never Stripe. */
async function loadExpectation(
  supabase: SupabaseClient,
  row: ClaimRow,
  liveMode: boolean
): Promise<OrderExpectation | null> {
  const { data } = await supabase
    .from("orders")
    .select("id,status,payment_due_cents,total_cents,currency")
    .eq("id", row.order_id)
    .maybeSingle()

  if (!data) {
    return null
  }

  const due = Number(data.payment_due_cents ?? data.total_cents)
  if (!Number.isFinite(due)) {
    return null
  }

  return {
    orderId: String(data.id),
    sessionId: row.provider_session_id,
    paymentDueCents: due,
    currency: String(data.currency ?? "USD"),
    liveMode,
    status: String(data.status)
  }
}
