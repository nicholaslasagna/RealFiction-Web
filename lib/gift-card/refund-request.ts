import "server-only"

// The Stripe refund request for a gift-card purchase.
//
// EVERY VALUE COMES FROM THE SERVER
// =================================
// The amount is the eligible external ceiling the database computed under a
// lock — `actually paid − already refunded` — never the card's face value and
// never anything a client sent. A gift card's face value and its purchase price
// happen to coincide today, but they are different things: an operator-issued
// card, or an order already partially refunded, would make face value a lie.
//
// The idempotency key is deterministic on OUR refund workflow id, so a retry
// after a timeout returns Stripe's original Refund rather than creating a
// second one. That is the whole defence against double-refunding on a lost
// response, and it is why the key must not include a timestamp or a nonce.

import { STRIPE_API_VERSION } from "@/lib/payments"

export type GiftCardRefundRequest = {
  /** OUR workflow id. Becomes the idempotency key. */
  refundId: string
  /** Charge or PaymentIntent to refund against, from our own order record. */
  paymentIntentId: string | null
  chargeId: string | null
  /** Server-computed ceiling. Never a client value, never the face value. */
  amountCents: number
  currency: string
}

export type GiftCardRefundResult =
  | { kind: "succeeded"; providerRefundId: string; amountCents: number; status: string }
  | { kind: "pending"; providerRefundId: string; status: string }
  | { kind: "failed"; category: string }
  | { kind: "uncertain"; category: string }

/** Stable per workflow. A retry must reach the SAME Stripe Refund. */
export function refundIdempotencyKey(refundId: string): string {
  return `realfiction-giftcard-refund:${refundId}`
}

/**
 * Encodes the request. Exported so tests can assert the exact wire form without
 * a network call.
 */
export function encodeGiftCardRefundBody(request: GiftCardRefundRequest): URLSearchParams {
  const body = new URLSearchParams()

  // Prefer the PaymentIntent: it is what fulfilment recorded, and Stripe
  // resolves the charge from it. A charge id is the fallback for older records.
  if (request.paymentIntentId) {
    body.set("payment_intent", request.paymentIntentId)
  } else if (request.chargeId) {
    body.set("charge", request.chargeId)
  }

  body.set("amount", String(request.amountCents))
  // Marks the reason in the Dashboard without asserting fraud, which would be
  // a claim we cannot support from a refund request alone.
  body.set("reason", "requested_by_customer")
  body.set("metadata[realfiction_refund_id]", request.refundId)
  body.set("metadata[network]", "RealFiction")

  return body
}

/**
 * Issues the refund.
 *
 * The distinction that matters is `failed` versus `uncertain`. A definitive
 * provider rejection (a 4xx that is not a rate limit) means no money moved and
 * the workflow can be retried or reviewed. A timeout, a 429, or a 5xx means we
 * do NOT know — Stripe may have created the Refund and lost the response — so
 * the caller must keep the value frozen and let reconciliation settle it.
 * Treating uncertainty as failure is how a card gets refunded twice.
 */
export async function createGiftCardRefund(
  request: GiftCardRefundRequest,
  options: { secretKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<GiftCardRefundResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, options.timeoutMs ?? 10_000))

  try {
    const response = await fetchImpl("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": STRIPE_API_VERSION,
        // Deterministic: a retry returns the ORIGINAL Refund, never a second.
        "Idempotency-Key": refundIdempotencyKey(request.refundId)
      },
      body: encodeGiftCardRefundBody(request),
      signal: controller.signal
    })

    if (response.status === 429 || response.status >= 500) {
      // Retryable and, crucially, UNCERTAIN: a 500 can follow a Refund that was
      // actually created.
      return { kind: "uncertain", category: `provider_${response.status}` }
    }

    let payload: { id?: string; status?: string; amount?: number; error?: { code?: string; type?: string } }
    try {
      payload = (await response.json()) as typeof payload
    } catch {
      return { kind: "uncertain", category: "malformed_response" }
    }

    if (!response.ok) {
      // A definitive rejection. Only the machine-readable code is surfaced —
      // Stripe's human message can echo a redacted key fragment.
      return { kind: "failed", category: `${payload.error?.type ?? "unknown"}/${payload.error?.code ?? "unknown"}` }
    }

    if (typeof payload.id !== "string" || !payload.id) {
      return { kind: "uncertain", category: "missing_refund_id" }
    }

    const status = String(payload.status ?? "")
    if (status === "succeeded") {
      return {
        kind: "succeeded",
        providerRefundId: payload.id,
        // Stripe's echoed amount, which the caller checks against its ceiling.
        amountCents: Number(payload.amount ?? 0),
        status
      }
    }
    if (status === "failed" || status === "canceled") {
      return { kind: "failed", category: `refund_${status}` }
    }
    // `pending` or a status we do not recognise: the money may yet move.
    return { kind: "pending", providerRefundId: payload.id, status: status || "unknown" }
  } catch {
    // Aborted, DNS, connection reset. Uncertain, never failed.
    return { kind: "uncertain", category: "provider_unreachable" }
  } finally {
    clearTimeout(timer)
  }
}
