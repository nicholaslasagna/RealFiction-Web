// POST /api/store/gift-cards/checkout
//
// The only way to start a gift-card purchase.
//
// DELIBERATELY NOT PART OF ORDINARY CHECKOUT
// ==========================================
// `/api/store/checkout` resolves a cart of Minecraft products, may apply store
// credit, may be a gift to a Minecraft username, and lets Stripe offer whatever
// payment methods the account has enabled. Every one of those is wrong for
// stored value:
//
//   * store credit buying stored value is a laundering loop;
//   * a gift card has no Minecraft recipient, it has an EMAIL recipient;
//   * several dynamic payment methods prohibit prepaid stored value outright.
//
// Sharing the route would mean each of those rules living as a conditional
// inside a flow whose default is the opposite. So this is its own entry point,
// and `rejectUnsellableProducts` keeps gift-card slugs out of the ordinary one.
//
// ORDER OF OPERATIONS
// ===================
// Every rejection below happens BEFORE the pending order exists. Past that
// point the route owns cleanup: if Stripe fails, the order is cancelled and the
// attempt closed, so a failed purchase leaves nothing behind for reconciliation
// to puzzle over.

import { getAuthenticatedUser } from "@/lib/supabase/server"
import { safeJsonError } from "@/lib/security"
import {
  attachCheckoutAttemptOrder,
  attachCheckoutSession,
  attachProviderSession,
  cancelOrder,
  claimCheckoutAttempt,
  closeCheckoutAttempt,
  createPendingOrder,
  CheckoutGuardUnavailableError,
  resolveCheckoutLines
} from "@/lib/store-server"
import { isGiftCardCryptoConfigured } from "@/lib/gift-card/crypto"
import {
  GIFT_CARD_UNAVAILABLE,
  evaluateGiftCardAvailability,
  parseGiftCardCheckout
} from "@/lib/gift-card/checkout-policy"
import { createGiftCardCheckoutSession } from "@/lib/gift-card/stripe-request"
import {
  ABUSE_BLOCKED_MESSAGE,
  ABUSE_UNAVAILABLE_MESSAGE,
  AbuseControlsUnavailableError,
  evaluateGiftCardPurchase,
  resolveSubjects
} from "@/lib/abuse/guard"

export const dynamic = "force-dynamic"

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://realfiction.live"
}

export async function POST(request: Request) {
  // ---- Gate first. Nothing below runs if gift cards are not fully ready. ----
  const availability = evaluateGiftCardAvailability(process.env, {
    cryptoConfigured: isGiftCardCryptoConfigured(process.env)
  })

  if (!availability.available) {
    // The REASON goes to the server log for the operator; the customer gets one
    // flat message. "GIFT_CARD_CLAIM_PEPPER is unset" helps an attacker and
    // helps no customer.
    console.warn("gift_card_checkout_unavailable", { reason: availability.reason })
    return safeJsonError(GIFT_CARD_UNAVAILABLE.message, GIFT_CARD_UNAVAILABLE.status)
  }

  const user = await getAuthenticatedUser().catch(() => null)
  if (!user) {
    return safeJsonError("Please sign in to buy a gift card.", 401)
  }

  const verifiedAt =
    (user as { email_confirmed_at?: string | null }).email_confirmed_at ??
    (user as { confirmed_at?: string | null }).confirmed_at ??
    null

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return safeJsonError("Something in your request does not look right.", 400)
  }

  // All input validation, in one pure function. The result carries the face
  // value read from OUR denomination table — the request never names a price.
  const parsed = parseGiftCardCheckout(payload as Record<string, unknown>, {
    verifiedEmail: verifiedAt && user.email ? user.email : null
  })

  if (!parsed.ok) {
    return safeJsonError(parsed.rejection.message, parsed.rejection.status)
  }

  const intent = parsed.intent

  // Reject the ordinary-checkout shapes outright rather than ignoring them. A
  // client sending `applyStoreCredit` or `giftRecipient` has misunderstood what
  // this endpoint is, and silently dropping the field would hide that.
  const raw = payload as Record<string, unknown>
  for (const forbidden of ["applyStoreCredit", "giftRecipient", "items", "provider", "couponCode", "quantity"]) {
    if (raw[forbidden] !== undefined) {
      return safeJsonError("Something in your request does not look right.", 400)
    }
  }

  // ---- Velocity. Before the order, the reservation, and Stripe. -----------
  // A refusal here leaves nothing to clean up, and the attempt is still counted,
  // so hammering the endpoint makes the next decision stricter rather than
  // resetting anything.
  //
  // FAILS CLOSED. If the controls cannot decide — unconfigured pepper, database
  // down, unrecognised answer — this returns 503 and stops. Selling stored value
  // with the velocity limits, the value ceilings, and the recipient checks all
  // silently off is not an acceptable degraded mode.
  let velocity: { decision: string; rule: string | null }
  try {
    const subjects = await resolveSubjects({
      actor: user.id,
      request,
      email: user.email,
      recipientEmail: intent.recipientEmail
    })
    velocity = await evaluateGiftCardPurchase(subjects, intent.faceValueCents)
  } catch (error) {
    if (error instanceof AbuseControlsUnavailableError) {
      // Nothing exists yet: no order, no attempt claim, no Stripe session.
      console.error("gift_card_checkout_controls_unavailable", { reason: error.reason })
      return safeJsonError(ABUSE_UNAVAILABLE_MESSAGE, 503)
    }
    throw error
  }

  if (velocity.decision === "block") {
    // One flat message. Naming the rule, the count, or the window would hand
    // over the thresholds, and a 429 with a Retry-After would leak the window
    // just as effectively.
    console.warn("gift_card_checkout_blocked", { rule: velocity.rule, actor: user.id })
    return safeJsonError(ABUSE_BLOCKED_MESSAGE, 403)
  }
  // `review` proceeds: the customer buys, and a human looks afterwards. Blocking
  // a real customer over a soft signal is the worse error.

  let attemptClaimId: string | null = null
  let orderId: string | null = null

  try {
    // ---- The authoritative product row. -----------------------------------
    // Resolved from the database, not from the catalog constant: if the row is
    // inactive (which it is until an operator enables gift cards) this throws
    // and nothing has been created.
    const lines = await resolveCheckoutLines({ items: [{ productId: intent.slug, quantity: 1 }] } as never)

    if (lines.length !== 1 || lines[0].quantity !== 1) {
      return safeJsonError("Gift cards are bought one at a time.", 400)
    }

    const product = lines[0].product
    if (product.category !== "gift_cards") {
      // The slug passed our denomination table but resolved to something else.
      return safeJsonError("Something in your request does not look right.", 400)
    }

    // The price the customer pays comes from the PRODUCT ROW, and must agree
    // with our table. A disagreement means the database and the code have
    // drifted, which is a stop-everything condition, not a rounding question.
    if (product.price_cents !== intent.faceValueCents) {
      console.error("gift_card_price_drift", {
        slug: intent.slug,
        product_cents: product.price_cents,
        catalog_cents: intent.faceValueCents
      })
      return safeJsonError(GIFT_CARD_UNAVAILABLE.message, 503)
    }

    // ---- Bounded attempt, so a double-click cannot become two orders. ------
    const fingerprint = [
      user.id,
      "giftcard",
      intent.slug,
      intent.recipientEmail,
      intent.sendToSelf ? "self" : "other"
    ].join("|")

    const attempt = await claimCheckoutAttempt(user.id, intent.checkoutAttemptId, fingerprint, 1800)
    attemptClaimId = attempt.claimId

    if (attempt.storedFingerprint && attempt.storedFingerprint !== fingerprint) {
      return safeJsonError("Your gift card details changed. Please start again.", 409)
    }

    // A live session for this same attempt: replay it rather than creating a
    // second payable link.
    if (attempt.sessionUrl && attempt.existingOrderId) {
      return Response.json({
        checkoutUrl: attempt.sessionUrl,
        orderId: attempt.existingOrderId,
        reused: true
      })
    }

    // ---- Pending order. Past here, failures must clean up. -----------------
    orderId = await createPendingOrder(
      { items: [{ productId: intent.slug, quantity: 1 }] } as never,
      lines,
      user,
      {
        // A gift card has no Minecraft delivery target: RealCore never sees it.
        minecraftUsername: null,
        minecraftUuid: null,
        giftRecipient: null,
        isGift: false,
        source: "gift_card_checkout",
        provider: "stripe",
        // Stored value is never bought with stored value.
        storeCreditCents: 0,
        paymentDueCents: intent.faceValueCents,
        discountCents: 0,
        buyerEmail: user.email as string
      }
    )

    await attachCheckoutAttemptOrder(attempt.claimId, orderId)

    // The recipient, sender name, and message are snapshotted on the ORDER, so
    // issuance reads them from our own record rather than from anything the
    // client sends later.
    await persistGiftDetails(orderId, intent)

    // ---- Stripe. -----------------------------------------------------------
    const session = await createGiftCardCheckoutSession(
      {
        orderId,
        slug: intent.slug,
        faceValueCents: intent.faceValueCents,
        buyerEmail: user.email as string,
        publicRefHint: orderId.slice(0, 8)
      },
      siteUrl()
    )

    if (!session.providerSessionId || !session.checkoutUrl) {
      throw new Error("Stripe returned no session.")
    }

    const attached = await attachCheckoutSession({
      claimId: attempt.claimId,
      sessionId: session.providerSessionId,
      sessionUrl: session.checkoutUrl,
      sessionExpiresAt: session.sessionExpiresAt
    })

    if (!attached) {
      // A different session is already bound to this attempt. The one we just
      // created would remain payable and untracked, so refuse rather than
      // displace it.
      throw new Error("A different checkout session is already attached.")
    }

    // Persist the session on the ORDER as well, exactly as ordinary checkout
    // does. Reconciliation selects only orders carrying a session id — without
    // this a gift-card payment whose webhook was lost could never be recovered,
    // because nothing would know which session to ask Stripe about.
    await attachProviderSession(orderId, session.providerSessionId)

    console.info("gift_card_checkout_created", { order_id: orderId, slug: intent.slug })

    return Response.json({ checkoutUrl: session.checkoutUrl, orderId })
  } catch (error) {
    // Nothing partially created survives: no session persisted means no card,
    // no credential, no email, and no value anybody paid for but cannot reach.
    if (orderId) {
      await cancelOrder(orderId).catch(() => undefined)
    }
    if (attemptClaimId) {
      await closeCheckoutAttempt(attemptClaimId, "gift_card_checkout_failed").catch(() => undefined)
    }

    if (error instanceof CheckoutGuardUnavailableError) {
      console.error("gift_card_checkout_guard_unavailable", { guard: error.guard })
      return safeJsonError("Checkout is temporarily unavailable. Nothing has been charged.", 503)
    }

    // The message is never surfaced: it can carry a Stripe error shape.
    console.error("gift_card_checkout_failed")
    return safeJsonError("We could not start that checkout. Nothing has been charged.", 502)
  }
}

/**
 * Snapshots the gift details onto the order.
 *
 * Kept out of `createPendingOrder` so the ordinary checkout path is untouched.
 * Issuance reads these back — never a later client request — so a customer
 * cannot redirect somebody else's paid card by replaying a webhook.
 */
async function persistGiftDetails(
  orderId: string,
  intent: { recipientEmail: string; senderName: string; message: string; sendToSelf: boolean }
) {
  const { getSupabaseServiceRoleClient } = await import("@/lib/supabase/service-role")
  const supabase = getSupabaseServiceRoleClient()

  const { data: existing } = await supabase
    .from("orders")
    .select("metadata")
    .eq("id", orderId)
    .maybeSingle()

  const metadata = {
    ...((existing?.metadata as Record<string, unknown>) ?? {}),
    order_kind: "gift_card",
    gift_recipient_email: intent.recipientEmail,
    gift_sender_name: intent.senderName,
    gift_message: intent.message,
    gift_sent_to_self: intent.sendToSelf
  }

  const { error } = await supabase.from("orders").update({ metadata }).eq("id", orderId)
  if (error) {
    // Without the recipient, issuance cannot deliver the card. Fail the whole
    // checkout rather than take money for something undeliverable.
    throw new Error("Could not record gift card details.")
  }
}
