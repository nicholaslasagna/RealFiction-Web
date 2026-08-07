// Recovery for gift-card refunds whose provider result was never learned.
//
// Stripe created the Refund and the HTTP response — or the webhook, or both —
// was lost. The workflow sits in `provider_refund_pending` with the value
// frozen or the card void, which is the SAFE side of that uncertainty: nobody
// can spend it and nobody has been double-refunded. But it never finalises on
// its own, so the money is gone from Stripe and the ledger still shows it.
//
// This asks Stripe what actually happened. The deterministic idempotency key
// used when the refund was requested means the Refund can be found by listing
// against the payment — no second refund is ever created here.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

export type RefundReconcileEnv = {
  SUPABASE_URL?: string
  NEXT_PUBLIC_SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  STRIPE_SECRET_KEY?: string
}

export type RefundReconcileResult = {
  selected: number
  finalized: number
  retried: number
  review: number
}

export const REFUND_RECONCILE_DEFAULTS = {
  batchSize: 10,
  maxBatch: 100,
  leaseSeconds: 120,
  requestTimeoutMs: 8_000,
  minAgeSeconds: 60,
  maxAttempts: 10
} as const

type ClaimRow = {
  refund_id: string
  gift_card_id: string
  purchaser_order_id: string | null
  eligible_external_cents: number
  attempts: number
}

function supabaseFor(env: RefundReconcileEnv): SupabaseClient | null {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  return url && key
    ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    : null
}

/**
 * Finds the Refund we created for this workflow, by our own metadata.
 *
 * Listing rather than creating: a second `POST /v1/refunds` would be safe
 * because of the idempotency key, but only within Stripe's key retention
 * window. Reading is correct at any age.
 */
async function findRefund(
  fetchImpl: typeof fetch,
  stripeKey: string,
  paymentIntentId: string,
  refundId: string,
  timeoutMs: number
): Promise<{ id: string; status: string; amount: number } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(
      `https://api.stripe.com/v1/refunds?payment_intent=${encodeURIComponent(paymentIntentId)}&limit=100`,
      { headers: { Authorization: `Bearer ${stripeKey}` }, signal: controller.signal }
    )
    if (!response.ok) {
      return null
    }
    const payload = (await response.json()) as {
      data?: { id?: string; status?: string; amount?: number; metadata?: Record<string, string> }[]
    }
    const match = (payload.data ?? []).find(
      (refund) => refund.metadata?.realfiction_refund_id === refundId
    )
    if (!match?.id) {
      return null
    }
    return { id: match.id, status: String(match.status ?? ""), amount: Number(match.amount ?? 0) }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Reconciles one bounded, claimed batch. Never throws.
 *
 * The three outcomes mirror the payment reconciler: finalise on authoritative
 * success, retry on uncertainty, review on a contradiction. Nothing here
 * unfreezes value or reverses credit outside `complete_gift_card_refund`.
 */
export async function reconcileGiftCardRefunds(
  env: RefundReconcileEnv,
  options: { batchSize?: number; workerId?: string; fetchImpl?: typeof fetch; requestTimeoutMs?: number } = {}
): Promise<RefundReconcileResult> {
  const result: RefundReconcileResult = { selected: 0, finalized: 0, retried: 0, review: 0 }

  const supabase = supabaseFor(env)
  const stripeKey = env.STRIPE_SECRET_KEY?.trim()
  if (!supabase || !stripeKey) {
    return result
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = Math.max(1_000, options.requestTimeoutMs ?? REFUND_RECONCILE_DEFAULTS.requestTimeoutMs)
  const batchSize = Math.max(
    1,
    Math.min(options.batchSize ?? REFUND_RECONCILE_DEFAULTS.batchSize, REFUND_RECONCILE_DEFAULTS.maxBatch)
  )

  let rows: ClaimRow[] = []
  try {
    const { data, error } = await supabase.rpc("claim_pending_gift_card_refunds", {
      p_worker: options.workerId ?? `refund-${Date.now()}`,
      p_limit: batchSize,
      p_lease_seconds: REFUND_RECONCILE_DEFAULTS.leaseSeconds,
      p_min_age_seconds: REFUND_RECONCILE_DEFAULTS.minAgeSeconds
    })
    if (error) return result
    rows = (data ?? []) as ClaimRow[]
  } catch {
    console.error("gift_card_refund_reconcile_claim_failed")
    return result
  }

  result.selected = rows.length

  for (const row of rows) {
    let category = "provider_unreachable"
    let deferred = true

    try {
      const { data: order } = await supabase
        .from("orders")
        .select("provider_payment_id")
        .eq("id", String(row.purchaser_order_id ?? ""))
        .maybeSingle()

      const paymentIntentId = (order?.provider_payment_id as string | null) ?? null

      if (paymentIntentId) {
        const refund = await findRefund(fetchImpl, stripeKey, paymentIntentId, row.refund_id, timeoutMs)

        if (refund && refund.status === "succeeded") {
          // AUTHORITATIVE. Finalise through the same bounded, idempotent
          // function the webhook uses.
          const { data } = await supabase.rpc("complete_gift_card_refund", {
            p_refund_id: row.refund_id,
            p_provider_refund_id: refund.id,
            p_refunded_cents: refund.amount
          })
          const outcome = String(
            (Array.isArray(data) ? data[0] : data)?.outcome ?? "unknown"
          )

          if (outcome === "completed" || outcome === "already_completed") {
            result.finalized++
            deferred = false
          } else {
            // The amount disagreed with our ceiling. Never reverse on that.
            category = "amount_mismatch"
          }
        } else if (refund && (refund.status === "failed" || refund.status === "canceled")) {
          category = `refund_${refund.status}`
        } else if (refund) {
          category = `refund_${refund.status || "pending"}`
        } else {
          category = "refund_not_found"
        }
      } else {
        category = "no_payment_reference"
      }
    } catch {
      category = "reconcile_error"
    }

    if (deferred) {
      try {
        const { data } = await supabase.rpc("defer_gift_card_refund", {
          p_refund_id: row.refund_id,
          p_category: category,
          p_max_attempts: REFUND_RECONCILE_DEFAULTS.maxAttempts
        })
        const finished = (Array.isArray(data) ? data[0] : data) as { review?: boolean } | null
        if (finished?.review === true) {
          result.review++
        } else {
          result.retried++
        }
      } catch {
        console.error("gift_card_refund_defer_failed")
      }
    }

    // Safe summary only: our own ids and a category.
    console.info("gift_card_refund_reconciled", {
      refund: row.refund_id,
      finalized: !deferred,
      category: deferred ? category : "succeeded"
    })
  }

  if (result.selected > 0) {
    console.info("gift_card_refund_reconcile_batch", result)
  }

  return result
}
