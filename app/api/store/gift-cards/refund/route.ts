// POST /api/store/gift-cards/refund
//
// The customer entry point for refunding a gift card they bought.
//
// AUTHORIZATION IS THE WHOLE POINT OF THIS FILE
// =============================================
// `requestGiftCardRefund` trusts its caller completely — it will refund any
// card it is handed. Everything that decides WHO may move money lives here, and
// it must land with the route rather than after it.
//
// The client names an ORDER and nothing else. Amount, payment identity,
// recipient, eligibility, and state are all resolved server-side; a request
// that carries any of them is refused rather than having them ignored, because
// silently dropping a monetary field hides a caller that believes it set one.

import { getAuthenticatedUser } from "@/lib/supabase/server"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"
import { safeJsonError } from "@/lib/security"
import { checkSameOrigin } from "@/lib/auth/same-origin"
import { giftCardForOrder, requestGiftCardRefund } from "@/lib/gift-card/refunds"
import {
  ABUSE_BLOCKED_MESSAGE,
  ABUSE_UNAVAILABLE_MESSAGE,
  areAbuseControlsConfigured,
  checkActorRule,
  recordAbuseEvent,
  resolveSubjects
} from "@/lib/abuse/guard"

export const dynamic = "force-dynamic"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Fields a client must never supply. Presence is a rejection, not a no-op. */
const FORBIDDEN = [
  "amount",
  "amountCents",
  "refundCents",
  "price",
  "priceCents",
  "faceValue",
  "currency",
  "paymentIntentId",
  "chargeId",
  "recipientEmail",
  "recipientUserId",
  "giftCardId",
  "eligible",
  "state",
  "refundId"
]

export async function POST(request: Request) {
  // Same-origin boundary for a browser-session mutation. SameSite=Lax
  // already blocks CSRF today, but that is a library default this
  // application does not control. See lib/auth/same-origin.ts.
  const sameOrigin = checkSameOrigin(request)
  if (!sameOrigin.ok) {
    console.warn("cross_origin_mutation_rejected", { route: "store/gift-cards/refund", reason: sameOrigin.reason })
    return safeJsonError("Something in your request does not look right.", 403)
  }

  const user = await getAuthenticatedUser().catch(() => null)
  if (!user) {
    return safeJsonError("Please sign in to request a refund.", 401)
  }

  let payload: Record<string, unknown>
  try {
    payload = (await request.json()) as Record<string, unknown>
  } catch {
    return safeJsonError("Something in your request does not look right.", 400)
  }

  for (const field of FORBIDDEN) {
    if (payload[field] !== undefined) {
      return safeJsonError("Something in your request does not look right.", 400)
    }
  }

  const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : ""
  if (!UUID.test(orderId)) {
    return safeJsonError("Something in your request does not look right.", 400)
  }

  try {
    const supabase = getSupabaseServiceRoleClient()

    const { data: order } = await supabase
      .from("orders")
      .select("id,user_id,status")
      .eq("id", orderId)
      .maybeSingle()

    // A missing order and someone else's order return the SAME response. A
    // different answer for each would turn this route into an oracle for
    // discovering which order ids exist.
    if (!order || String(order.user_id ?? "") !== user.id) {
      console.warn("gift_card_refund_denied", { reason: "not_purchaser" })
      return safeJsonError("We could not find that order on your account.", 404)
    }

    // Authoritative classification, from the database — never event metadata or
    // a client hint. Fails closed: an unknown classification is not a refund.
    const giftCardId = await giftCardForOrder(orderId)
    if (!giftCardId) {
      // An ordinary product order. Its refunds go through the existing support
      // path, not this endpoint.
      return safeJsonError("That order is not a gift card purchase.", 400)
    }

    // ---- Refund velocity. -------------------------------------------------
    // Checked AFTER ownership, so the throttle cannot be used to probe which
    // orders exist, and before any Stripe call, so a throttled request costs
    // nothing externally. Fails closed: repeated refunding is the abuse this
    // exists to stop, and one refused retry is a cheap price.
    if (!areAbuseControlsConfigured()) {
      // Before any Stripe refund and before any internal reversal.
      console.error("gift_card_refund_controls_unconfigured")
      return safeJsonError(ABUSE_UNAVAILABLE_MESSAGE, 503)
    }

    const refundVelocity = await checkActorRule(
      "refund_requests_24h",
      "gift_card_refund_request",
      user.id
    )
    await recordAbuseEvent(
      "gift_card_refund_request",
      await resolveSubjects({ actor: user.id, request, email: user.email })
    )

    if (refundVelocity.decision === "block") {
      console.warn("gift_card_refund_blocked", { actor: user.id })
      return safeJsonError(ABUSE_BLOCKED_MESSAGE, 403)
    }
    // `review` still refunds — the refund itself is bounded and reversible — but
    // a human is now looking at the pattern.

    const result = await requestGiftCardRefund(giftCardId)

    // The response is deliberately coarse. A purchaser must not be able to
    // learn from it whether the recipient has claimed or spent anything —
    // "requires review" covers claimed-and-spent, reserved, and disputed alike.
    switch (result.outcome) {
      case "refunded":
        return Response.json({ status: "refunded" })
      case "review_required":
        return Response.json({ status: "review_required" })
      case "provider_uncertain":
        return Response.json({ status: "processing" })
      case "provider_failed":
        return Response.json({ status: "processing" })
      case "rejected":
        return Response.json({ status: "not_refundable" }, { status: 409 })
      default:
        return safeJsonError("Refunds are temporarily unavailable.", 503)
    }
  } catch {
    console.error("gift_card_refund_route_error")
    return safeJsonError("Refunds are temporarily unavailable.", 503)
  }
}

/** A refund must never be triggerable by a link, a scanner, or a prefetch. */
export async function GET() {
  return Response.json(
    { error: "Refund requests must be submitted explicitly." },
    { status: 405, headers: { Allow: "POST" } }
  )
}
