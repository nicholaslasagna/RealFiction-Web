// Server-only reconciliation of unresolved Stripe-backed upgrade reservations.
//
// Postgres cannot call Stripe, so this is the application half of the decision:
// it retrieves the authoritative Checkout Session and hands the verdict to
// `apply_upgrade_reconciliation`, which owns every state transition.
//
// Runs from the Cloudflare scheduled handler alongside the email queue, so no
// second Cron schedule is needed. Like the email processor it takes an EXPLICIT
// env — `process.env` is not populated in `scheduled()`.
//
// The bias is always the same: when anything is uncertain, HOLD. Releasing a
// reservation for a customer who has already paid is the failure we refuse.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

export type ReconcileEnv = {
  SUPABASE_URL?: string
  NEXT_PUBLIC_SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_ENVIRONMENT?: string
}

export type ReconcileResult = {
  checked: number
  held: number
  released: number
  mismatched: number
  unavailable: number
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
}

/**
 * Maps a Stripe Checkout Session onto a verdict, after proving the session
 * really belongs to this order.
 *
 * Pure and exported so every branch is unit-testable without network access.
 * A binding, environment, currency, or amount mismatch is NEVER treated as a
 * failure to release — it returns `mismatch`, which holds.
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
  const boundOrder = session.metadata?.order_id ?? session.client_reference_id ?? null
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

  if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
    return "paid"
  }
  if (session.status === "complete") {
    // Complete but not yet `paid` means a delayed/async method is settling.
    return "async_pending"
  }
  if (session.payment_status === "unpaid" && session.status === "open") {
    return "async_pending"
  }
  if (session.status === "expired") {
    return "expired_unpaid"
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

/**
 * Reconciles a bounded batch. Never throws: a reconciliation problem must not
 * surface anywhere near order or payment state.
 */
export async function reconcileUpgradeReservations(
  env: ReconcileEnv,
  options: { batchSize?: number; fetchImpl?: typeof fetch } = {}
): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, held: 0, released: 0, mismatched: 0, unavailable: 0 }
  const supabase = supabaseFor(env)
  const fetchImpl = options.fetchImpl ?? fetch

  if (!supabase || !env.STRIPE_SECRET_KEY?.trim()) {
    // No bindings: leave every reservation exactly as it is.
    return result
  }

  const liveMode = (env.STRIPE_ENVIRONMENT ?? "").trim().toLowerCase() === "live"

  try {
    const { data, error } = await supabase.rpc("upgrade_reservations_needing_reconciliation", {
      p_limit: options.batchSize ?? 20
    })
    if (error) {
      return result
    }

    const rows = (data ?? []) as Array<{
      reservation_id: string
      order_id: string
      provider_session_id: string
    }>

    for (const row of rows) {
      result.checked++

      // Expected amount comes from OUR order, never from the session.
      const { data: order } = await supabase
        .from("orders")
        .select("payment_due_cents,currency")
        .eq("id", row.order_id)
        .maybeSingle()

      let verdict: ProviderVerdict = "provider_unreachable"

      try {
        const response = await fetchImpl(
          `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(row.provider_session_id)}`,
          { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }
        )

        if (response.ok) {
          const session = (await response.json()) as SessionShape
          verdict = classifySession(session, {
            orderId: row.order_id,
            sessionId: row.provider_session_id,
            expectedAmountCents: Number(order?.payment_due_cents ?? -1),
            expectedCurrency: String(order?.currency ?? "USD"),
            liveMode
          })
        }
        // A non-2xx (including 404) leaves the verdict as provider_unreachable,
        // which HOLDS. A missing session is not proof it went unpaid.
      } catch {
        verdict = "provider_unreachable"
      }

      const { data: applied } = await supabase.rpc("apply_upgrade_reconciliation", {
        p_reservation_id: row.reservation_id,
        p_provider_status: verdict,
        p_provider_session_id: row.provider_session_id
      })

      const outcome = String(
        (Array.isArray(applied) ? applied[0] : applied)?.outcome ?? "unknown"
      )

      if (outcome.startsWith("released_")) {
        result.released++
      } else if (verdict === "mismatch") {
        result.mismatched++
      } else if (verdict === "provider_unreachable") {
        result.unavailable++
      } else {
        result.held++
      }

      // Log the decision only — never the session payload or the secret.
      console.info("upgrade_reconciled", {
        reservation_id: row.reservation_id,
        verdict,
        outcome
      })
    }
  } catch {
    console.error("upgrade_reconciliation_unexpected_error")
  }

  return result
}
