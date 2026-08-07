// The Stripe Checkout request for a gift card.
//
// SEPARATE FROM ORDINARY PRODUCT CHECKOUT ON PURPOSE
// ==================================================
// Ordinary products omit `payment_method_types` so Stripe offers whatever the
// account has enabled — dynamic payment methods, which is the right default for
// them. It is the wrong default here: several methods Stripe can surface that
// way (notably BNPL) prohibit purchases of prepaid stored value in their own
// terms. Inheriting the account's dynamic set would mean a gift card could be
// bought with a method that forbids it, and we would only find out through a
// dispute.
//
// So this request pins `payment_method_types[0]=card`. Apple Pay and Google Pay
// still work: Stripe surfaces both as wallet presentations of `card`, not as
// separate payment method types.
//
// Nothing here reads a client value. The amount comes from our denomination
// table, the currency is fixed, the quantity is fixed at one.

import "server-only"

import { stripeSessionExpiresAt } from "@/lib/checkout-guard"
import { STRIPE_API_VERSION } from "@/lib/payments"

export type GiftCardStripeOrder = {
  orderId: string
  slug: string
  /** From our denomination table. Never from the request. */
  faceValueCents: number
  /** The buyer's VERIFIED address, snapshotted at checkout. */
  buyerEmail: string
  publicRefHint: string
}

/**
 * Builds the encoded request body.
 *
 * Exported separately from the fetch so tests can assert the exact encoding
 * without a network call or a live key.
 */
export function buildGiftCardCheckoutBody(order: GiftCardStripeOrder, siteUrl: string): URLSearchParams {
  const body = new URLSearchParams()

  body.set("mode", "payment")
  body.set("client_reference_id", order.orderId)

  // CARD ONLY. See the header comment: dynamic payment methods may include
  // methods that prohibit stored-value purchases.
  body.set("payment_method_types[0]", "card")

  body.set("customer_email", order.buyerEmail)
  body.set("payment_intent_data[receipt_email]", order.buyerEmail)

  body.set("expires_at", String(stripeSessionExpiresAt(Date.now())))
  body.set("success_url", `${siteUrl}/account?checkout=success&order_id=${order.orderId}`)
  body.set("cancel_url", `${siteUrl}/store?checkout=cancelled&order_id=${order.orderId}`)

  // Safe metadata only: identity and face value. The recipient address, the
  // sender's name, and the personal message are NOT sent to Stripe — they are
  // the customer's private content and Stripe has no need for them.
  body.set("metadata[network]", "RealFiction")
  body.set("metadata[order_id]", order.orderId)
  body.set("metadata[order_kind]", "gift_card")
  body.set("metadata[gift_card_sku]", order.slug)
  body.set("metadata[face_value_cents]", String(order.faceValueCents))
  body.set("metadata[gift_card_ref]", order.publicRefHint)
  body.set("payment_intent_data[metadata][order_id]", order.orderId)
  body.set("payment_intent_data[metadata][order_kind]", "gift_card")

  body.set("line_items[0][quantity]", "1")
  body.set("line_items[0][price_data][currency]", "usd")
  body.set("line_items[0][price_data][unit_amount]", String(order.faceValueCents))
  body.set("line_items[0][price_data][product_data][name]", "RealFiction Gift Card")
  body.set(
    "line_items[0][price_data][product_data][description]",
    "Store credit for the RealFiction Minecraft network. Never expires. No fees."
  )
  body.set("line_items[0][price_data][product_data][metadata][internal_sku]", "gift_card")
  body.set("line_items[0][price_data][product_data][metadata][entitlement]", "store.credit")

  // Explicitly NOT set, each for a reason:
  //   allow_promotion_codes  — a discounted gift card is a laundering vector
  //   automatic_tax          — see the note in the route; stored value is not
  //                            the taxable supply, and turning this on would
  //                            need a Dashboard tax-code decision
  //   discounts              — no coupons on stored value
  //   after_expiration       — a recovery URL is a second payable link

  return body
}

export async function createGiftCardCheckoutSession(
  order: GiftCardStripeOrder,
  siteUrl: string
): Promise<{ checkoutUrl: string | null; providerSessionId: string | null; sessionExpiresAt: string | null }> {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) {
    throw new Error("Stripe is not configured.")
  }

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
      // Deterministic per order, exactly as ordinary checkout does: a retry
      // replays the original session instead of creating a second payable one.
      "Idempotency-Key": `realfiction-giftcard:${order.orderId}`
    },
    body: buildGiftCardCheckoutBody(order, siteUrl)
  })

  if (!response.ok) {
    let code = "unknown"
    let type = "unknown"
    try {
      const payload = (await response.json()) as { error?: { code?: string; type?: string } }
      code = payload.error?.code ?? code
      type = payload.error?.type ?? type
    } catch {
      // Non-JSON body; keep the defaults.
    }
    // Machine-readable fields only — never Stripe's human message, which can
    // echo a redacted key fragment.
    console.error("stripe_gift_card_session_error", { status: response.status, type, code })
    throw new Error(`Gift card checkout session could not be created (${type}/${code}).`)
  }

  const session = (await response.json()) as { url?: string; id?: string; expires_at?: number }

  return {
    checkoutUrl: session.url ?? null,
    providerSessionId: session.id ?? null,
    sessionExpiresAt:
      typeof session.expires_at === "number" ? new Date(session.expires_at * 1000).toISOString() : null
  }
}
