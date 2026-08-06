import "server-only"

import { orderConfirmationKey, refundConfirmationKey, sanitizeReceiptUrl } from "@/lib/email/queue"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

/**
 * Transactional email side effects for a paid order.
 *
 * Every function here is best-effort by design. The caller is a webhook that has
 * already accepted the customer's money and fulfilled the order; a mail outage
 * must never fail that webhook, roll back an order, or cause Stripe to retry.
 * Failures are recorded in email_deliveries for retry, and swallowed.
 */

/**
 * Enqueues the order confirmation. DOES NOT SEND.
 *
 * Called from the Stripe webhook, which must return 2xx without ever awaiting a
 * Resend request. The scheduled processor drains the queue. Idempotent on
 * `order_confirmation:<order_id>`, so a replayed webhook enqueues nothing new.
 *
 * Never throws: the order is already paid and fulfilled by the time this runs.
 */
export async function enqueueOrderConfirmation(
  orderId: string
): Promise<"queued" | "duplicate" | "skipped" | "failed"> {
  try {
    const supabase = getSupabaseServiceRoleClient()

    const { data: order } = await supabase
      .from("orders")
      .select("status,buyer_email")
      .eq("id", orderId)
      .maybeSingle<{ status: string; buyer_email: string | null }>()

    if (!order) {
      return "skipped"
    }

    // Only ever email about an order we actually got paid for.
    if (order.status !== "paid" && order.status !== "fulfilled") {
      return "skipped"
    }

    // The IMMUTABLE address captured at checkout. Never the profile's current
    // email: a later address change must not redirect an old order's mail.
    const recipient = (order.buyer_email ?? "").trim()
    if (!recipient) {
      return "skipped"
    }

    const { data, error } = await supabase.rpc("enqueue_email_delivery", {
      p_idempotency_key: orderConfirmationKey(orderId),
      p_template: "order_confirmation",
      p_recipient: recipient,
      p_order_id: orderId,
      p_params: {}
    })

    if (error) {
      console.error("email_enqueue_failed", { order_id: orderId, template: "order_confirmation" })
      return "failed"
    }

    const row = (Array.isArray(data) ? data[0] : data) as { created?: boolean } | null
    return row?.created ? "queued" : "duplicate"
  } catch {
    console.error("email_enqueue_unexpected_error", { order_id: orderId })
    return "failed"
  }
}

/**
 * Enqueues a refund confirmation. DOES NOT SEND.
 *
 * Keyed on the Stripe REFUND id, so the several events Stripe emits for one
 * refund (created, then updated…) collapse onto exactly one email. Callers must
 * only invoke this for a refund that reached status=succeeded.
 */
export async function enqueueRefundConfirmation(input: {
  orderId: string
  refundId: string
  refundedCents: number
  currency: string
  isFullRefund: boolean
  affectedItemName?: string | null
  entitlementStatus: "revoked" | "unchanged" | "under_review"
}): Promise<"queued" | "duplicate" | "skipped" | "failed"> {
  try {
    const supabase = getSupabaseServiceRoleClient()

    const { data: order } = await supabase
      .from("orders")
      .select("buyer_email")
      .eq("id", input.orderId)
      .maybeSingle<{ buyer_email: string | null }>()

    const recipient = (order?.buyer_email ?? "").trim()
    if (!recipient) {
      return "skipped"
    }

    const { data, error } = await supabase.rpc("enqueue_email_delivery", {
      p_idempotency_key: refundConfirmationKey(input.refundId),
      p_template: "refund_confirmation",
      p_recipient: recipient,
      p_order_id: input.orderId,
      // Safe render params only — amount and scope. No Stripe ids, no card data.
      p_params: {
        refundedCents: input.refundedCents,
        currency: input.currency,
        isFullRefund: input.isFullRefund,
        affectedItemName: input.affectedItemName ?? null,
        entitlementStatus: input.entitlementStatus
      }
    })

    if (error) {
      console.error("email_enqueue_failed", { order_id: input.orderId, template: "refund_confirmation" })
      return "failed"
    }

    const row = (Array.isArray(data) ? data[0] : data) as { created?: boolean } | null
    return row?.created ? "queued" : "duplicate"
  } catch {
    console.error("email_enqueue_unexpected_error", { order_id: input.orderId })
    return "failed"
  }
}

/**
 * Records the charge id and (when already known) the Stripe receipt URL.
 *
 * Best-effort and non-blocking: the receipt is an enrichment, never a
 * precondition for fulfilment. The URL is validated as HTTPS + Stripe-hosted
 * before it is stored, because it eventually renders into a customer email.
 */
export async function storeStripePaymentRefs(
  orderId: string,
  refs: { chargeId?: string | null; receiptUrl?: string | null }
) {
  const update: Record<string, string> = {}
  if (refs.chargeId) {
    update.stripe_charge_id = refs.chargeId
  }
  const receiptUrl = sanitizeReceiptUrl(refs.receiptUrl)
  if (receiptUrl) {
    update.stripe_receipt_url = receiptUrl
  }
  if (Object.keys(update).length === 0) {
    return
  }
  try {
    const supabase = getSupabaseServiceRoleClient()
    await supabase.from("orders").update(update).eq("id", orderId)
  } catch {
    // Never let receipt bookkeeping affect fulfilment.
  }
}
