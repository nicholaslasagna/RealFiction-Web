// Generic recovery for pending Stripe Checkout orders whose success webhook
// was permanently lost.
//
// WHAT MAKES THIS SAFE TO RUN
// ===========================
// It never decides that money moved. It asks Stripe, reduces the answer to the
// SAME verified-payment facts the webhook produces, puts them through the SAME
// gate, and on success calls the SAME fulfilment dispatch. There is no
// reconciliation-only fulfilment path and no product-specific branch here: an
// ordinary order, a mixed store-credit order, and a gift card differ only in
// what `fulfilVerifiedPayment` does with them.
//
// The bias when anything is uncertain is always the same: HOLD. Fulfilling
// twice and releasing a paid customer's reservation are both worse than waiting.
//
// Runs from the existing scheduled Worker alongside the email queue — no second
// Cron. Like the email processor it takes an EXPLICIT env, because `process.env`
// is not populated inside `scheduled()`.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { sessionBoundOrderId, sessionToFacts, verifyPaymentFacts } from "./payment-facts"

export type ReconcileEnv = {
  SUPABASE_URL?: string
  NEXT_PUBLIC_SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_ENVIRONMENT?: string
}

/**
 * Proposed operational defaults, mirroring `reconciliation_defaults()` in SQL.
 * Values, not hidden constants — an owner can change them in one place.
 */
export const RECONCILE_DEFAULTS = {
  batchSize: 10,
  maxBatch: 100,
  leaseSeconds: 120,
  requestTimeoutMs: 8_000,
  minAgeSeconds: 120,
  maxAttempts: 10
} as const

/** Outcome categories. Safe to log; never carry provider payloads or amounts. */
export type ReconcileOutcome =
  | "paid_fulfilled"
  | "already_fulfilled"
  | "async_pending"
  | "open_unpaid"
  | "expired_unpaid_cancelled"
  | "payment_failed_cancelled"
  | "provider_unavailable"
  | "mismatch_review"
  | "malformed_review"

export type ReconcileResult = {
  selected: number
  fulfilled: number
  retried: number
  cancelled: number
  review: number
  failed: number
}

type SessionShape = {
  id?: string
  status?: string
  payment_status?: string
  currency?: string
  amount_total?: number
  livemode?: boolean
  expires_at?: number
  client_reference_id?: string
  metadata?: Record<string, string>
  payment_intent?: string | { id?: string; status?: string; latest_charge?: unknown }
}

type ClaimRow = {
  order_id: string
  provider_session_id: string
  expected_amount_cents: number
  expected_currency: string
  attempts: number
}

/**
 * Classifies a retrieved session, AFTER proving it belongs to this order.
 *
 * Pure and exported so every branch is unit-testable with no network. A
 * binding, environment, currency, or amount disagreement is never a reason to
 * release anything — it returns `mismatch_review`, which preserves the
 * reservation and asks a human.
 */
export function classifyPendingSession(
  session: SessionShape | null,
  expected: { orderId: string; sessionId: string; amountCents: number; currency: string; liveMode: boolean }
): ReconcileOutcome {
  if (!session || typeof session.id !== "string") {
    // A 404, a timeout, a 500, malformed JSON — indistinguishable here, and all
    // of them mean "we do not know", not "it went unpaid".
    return "provider_unavailable"
  }

  // The session must be the one we stored AND must name this order. A session
  // belonging to somebody else must never drive this order.
  if (session.id !== expected.sessionId || sessionBoundOrderId(session) !== expected.orderId) {
    return "mismatch_review"
  }
  if (typeof session.livemode === "boolean" && session.livemode !== expected.liveMode) {
    return "mismatch_review"
  }
  if (
    typeof session.currency === "string" &&
    session.currency.toLowerCase() !== expected.currency.toLowerCase()
  ) {
    return "mismatch_review"
  }
  // Only meaningful once Stripe has settled a total.
  if (typeof session.amount_total === "number" && session.amount_total !== expected.amountCents) {
    return "mismatch_review"
  }

  // The PaymentIntent is the authority on a DELAYED method. A session sits at
  // `complete / unpaid` both while an ACH debit clears and after it bounces;
  // only the intent tells them apart, which is why it is expanded.
  const intent = session.payment_intent
  const intentStatus =
    intent && typeof intent === "object" && typeof intent.status === "string" ? intent.status : null

  if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
    return "paid_fulfilled"
  }
  if (intentStatus === "succeeded") {
    return "paid_fulfilled"
  }
  if (intentStatus === "canceled") {
    return "payment_failed_cancelled"
  }
  if (intentStatus === "processing" || intentStatus === "requires_action") {
    return "async_pending"
  }
  if (session.status === "expired") {
    // Expired AND unpaid: `payment_status` is checked above, so reaching here
    // means Stripe itself says no money was collected. This is the only branch
    // that may cancel, and only on the provider's word.
    return "expired_unpaid_cancelled"
  }
  if (session.status === "complete") {
    return "async_pending"
  }
  if (session.status === "open") {
    return "open_unpaid"
  }
  // Unrecognised. Hold.
  return "provider_unavailable"
}

function supabaseFor(env: ReconcileEnv): SupabaseClient | null {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  return url && key
    ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    : null
}

/** Retrieves the session with the PaymentIntent expanded, under a hard timeout. */
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
      // 404, 429, 500 alike. A missing session is NOT proof it went unpaid.
      return null
    }
    return (await response.json()) as SessionShape
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Reconciles one bounded, claimed batch.
 *
 * Never throws: a reconciliation problem must not surface near payment state,
 * and must not take the email queue down with it. One bad order does not abort
 * the batch.
 *
 * `fulfil` is injected so this module stays free of `server-only` and the
 * Worker can supply the real shared dispatch.
 */
export async function reconcilePendingStripeOrders(
  env: ReconcileEnv,
  options: {
    batchSize?: number
    requestTimeoutMs?: number
    workerId?: string
    fetchImpl?: typeof fetch
    fulfil: (
      orderId: string,
      facts: { paymentIntentId: string | null; chargeId: string | null; receiptUrl: string | null }
    ) => Promise<unknown>
  }
): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    selected: 0,
    fulfilled: 0,
    retried: 0,
    cancelled: 0,
    review: 0,
    failed: 0
  }

  const supabase = supabaseFor(env)
  const stripeKey = env.STRIPE_SECRET_KEY?.trim()

  // FAIL CLOSED. An unconfigured Worker is not evidence about any payment, so
  // it claims nothing rather than claiming and then failing every row.
  if (!supabase || !stripeKey) {
    return result
  }

  const liveMode = (env.STRIPE_ENVIRONMENT ?? "").trim().toLowerCase() === "live"
  const workerId = options.workerId ?? `reconcile-${Date.now()}`
  const timeoutMs = Math.max(1_000, options.requestTimeoutMs ?? RECONCILE_DEFAULTS.requestTimeoutMs)
  const batchSize = Math.max(
    1,
    Math.min(options.batchSize ?? RECONCILE_DEFAULTS.batchSize, RECONCILE_DEFAULTS.maxBatch)
  )
  const fetchImpl = options.fetchImpl ?? fetch

  let rows: ClaimRow[] = []
  try {
    const { data, error } = await supabase.rpc("claim_pending_reconciliations", {
      p_worker: workerId,
      p_limit: batchSize,
      p_lease_seconds: RECONCILE_DEFAULTS.leaseSeconds,
      p_min_age_seconds: RECONCILE_DEFAULTS.minAgeSeconds
    })
    if (error) {
      return result
    }
    rows = (data ?? []) as ClaimRow[]
  } catch {
    console.error("reconciliation_claim_failed")
    return result
  }

  result.selected = rows.length
  if (rows.length > 0) {
    console.info("reconciliation_batch", { selected: rows.length })
  }

  for (const row of rows) {
    let outcome: ReconcileOutcome = "provider_unavailable"
    let disposition: "resolved" | "retry" | "review" = "retry"
    let providerStatus = ""

    try {
      const session = await retrieveSession(fetchImpl, stripeKey, row.provider_session_id, timeoutMs)
      providerStatus = typeof session?.status === "string" ? session.status : ""

      outcome = classifyPendingSession(session, {
        orderId: row.order_id,
        sessionId: row.provider_session_id,
        amountCents: Number(row.expected_amount_cents),
        currency: String(row.expected_currency ?? "USD"),
        liveMode
      })

      if (outcome === "paid_fulfilled" && session) {
        // Re-read OUR order. Every expected amount comes from here, never Stripe.
        const { data: order } = await supabase
          .from("orders")
          .select("id,status,payment_due_cents,total_cents,currency,provider_session_id")
          .eq("id", row.order_id)
          .maybeSingle()

        const due = Number(order?.payment_due_cents ?? order?.total_cents)
        const facts = sessionToFacts(session, row.order_id, new Date().toISOString())

        if (!order || !facts || !Number.isFinite(due)) {
          outcome = "malformed_review"
          disposition = "review"
        } else {
          const gate = verifyPaymentFacts(facts, {
            orderId: String(order.id),
            sessionId: (order.provider_session_id as string | null) ?? row.provider_session_id,
            paymentDueCents: due,
            currency: String(order.currency ?? "USD"),
            liveMode,
            status: String(order.status)
          })

          if (!gate.ok && gate.reason.startsWith("order_not_fulfillable")) {
            // The webhook won the race. Nothing to do, and nothing wrong.
            outcome = "already_fulfilled"
            disposition = "resolved"
          } else if (!gate.ok) {
            outcome = "mismatch_review"
            disposition = "review"
          } else {
            // THE RECOVERY. Same shared dispatch the webhook uses.
            await options.fulfil(row.order_id, {
              paymentIntentId: facts.paymentIntentId,
              chargeId: facts.chargeId,
              receiptUrl: null
            })
            outcome = "paid_fulfilled"
            disposition = "resolved"
            result.fulfilled++
          }
        }
      } else if (outcome === "expired_unpaid_cancelled" || outcome === "payment_failed_cancelled") {
        // The ONLY branch that cancels, and only on the provider's word that no
        // money was collected. Releases the exact reservation, idempotently.
        await supabase.rpc("cancel_reconciled_unpaid_order", {
          p_order_id: row.order_id,
          p_reason: `reconciled_${outcome}`
        })
        disposition = "resolved"
        result.cancelled++
      } else if (outcome === "mismatch_review") {
        disposition = "review"
      } else {
        // async_pending, open_unpaid, provider_unavailable: hold and retry.
        disposition = "retry"
      }
    } catch {
      // A thrown fulfilment rolled its transaction back: the order is still
      // pending and the reservation is intact. Hold and retry.
      outcome = "provider_unavailable"
      disposition = "retry"
      result.failed++
    }

    try {
      const { data } = await supabase.rpc("finish_pending_reconciliation", {
        p_order_id: row.order_id,
        p_disposition: disposition,
        p_outcome: outcome,
        p_provider_status: providerStatus,
        p_diagnostic: outcome,
        p_max_attempts: RECONCILE_DEFAULTS.maxAttempts
      })
      const finished = (Array.isArray(data) ? data[0] : data) as
        | { disposition?: string; review?: boolean }
        | null

      if (finished?.review === true) {
        result.review++
      } else if (finished?.disposition === "retry") {
        result.retried++
      }
    } catch {
      // The lease expires on its own; a failed bookkeeping write is not a
      // payment problem.
      console.error("reconciliation_finish_failed")
    }

    // Safe summary only: an order id, a category, and the retry/review status.
    console.info("reconciliation_order", {
      order: row.order_id,
      outcome,
      disposition
    })
  }

  if (result.selected > 0) {
    console.info("reconciliation_batch_done", result)
  }

  return result
}
