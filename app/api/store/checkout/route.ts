import {
  createPayPalCheckout,
  createStripeCheckout,
  checkoutSchema,
  isPayPalConfigured,
  isStripeConfigured
} from "@/lib/payments"
import { safeJsonError } from "@/lib/security"
import { resolveDeliveryTarget } from "@/lib/store-delivery"
import { getAuthenticatedUser } from "@/lib/supabase/server"
import {
  attachProviderSession,
  cancelOrder,
  createPendingOrder,
  getVerifiedMinecraftLink,
  resolveCheckoutLines
} from "@/lib/store-server"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = checkoutSchema.safeParse(body)

  if (!parsed.success) {
    return Response.json({ error: "Something in your cart does not look right." }, { status: 400 })
  }

  if (parsed.data.provider === "stripe" && !isStripeConfigured()) {
    return safeJsonError("Card payments are not ready yet.", 503)
  }

  if (parsed.data.provider === "paypal" && !isPayPalConfigured()) {
    return safeJsonError("PayPal payments are not ready yet.", 503)
  }

  // Checkout requires a signed-in account — never create a paid order we cannot
  // tie back to a buyer.
  const user = await getAuthenticatedUser().catch(() => null)
  if (!user) {
    return safeJsonError("Sign in to checkout and deliver rewards safely.", 401)
  }

  const isGift = parsed.data.isGift === true
  const giftRecipient = parsed.data.giftRecipient?.trim() || null

  // The buyer's linked Minecraft account is resolved on the server. A client is
  // never trusted to name the delivery target for a normal purchase.
  const link = await getVerifiedMinecraftLink(user.id).catch(() => null)

  const resolution = resolveDeliveryTarget({
    isGift,
    giftRecipient,
    submittedUsername: undefined,
    linkedUsername: link?.username ?? null
  })

  // Secret-free structured log: presence booleans + the resolved source only.
  const baseLog = {
    provider: parsed.data.provider,
    has_gift_recipient: Boolean(giftRecipient),
    has_submitted_username: false,
    has_linked_minecraft: Boolean(link?.username),
    resolved_delivery_target_source: resolution.source
  }

  if (resolution.source === "missing") {
    console.info("checkout_delivery", { ...baseLog, order_id: null, fulfillment_status: "rejected" })
    if (isGift) {
      return safeJsonError("Enter the Minecraft username that should receive this gift.", 400)
    }
    return safeJsonError("Link your Minecraft account before checkout so rewards know where to go.", 409)
  }

  let step = "init"

  try {
    step = "resolve_products"
    const lines = await resolveCheckoutLines(parsed.data)

    step = "create_order"
    const orderId = await createPendingOrder(parsed.data, lines, user, {
      // The buyer's linked account is the purchaser-of-record and the delivery
      // target for a normal purchase; a gift overrides the target via
      // giftRecipient and clears the UUID so the recipient resolves by name.
      minecraftUsername: link?.username ?? null,
      minecraftUuid: isGift ? null : link?.uuid ?? null,
      giftRecipient: isGift ? giftRecipient : null,
      isGift,
      source: resolution.source
    })

    step = parsed.data.provider === "stripe" ? "stripe_session" : "paypal_order"
    const order = {
      id: orderId,
      provider: parsed.data.provider,
      minecraftUsername: resolution.username,
      giftRecipient: isGift ? giftRecipient : null,
      isGift
    }

    const result =
      parsed.data.provider === "stripe"
        ? await createStripeCheckout(order, lines)
        : await createPayPalCheckout(order, lines)

    if (!result.checkoutUrl) {
      await cancelOrder(orderId)
      console.error("checkout_delivery", { ...baseLog, order_id: orderId, fulfillment_status: "provider_no_url" })
      return safeJsonError("We could not start payment yet. Please try again.", 502)
    }

    step = "attach_session"
    await attachProviderSession(orderId, result.providerSessionId)

    console.info("checkout_delivery", { ...baseLog, order_id: orderId, fulfillment_status: "pending_payment" })

    return Response.json({
      checkoutUrl: result.checkoutUrl,
      orderId
    })
  } catch (error) {
    console.error("checkout_failed", {
      ...baseLog,
      step,
      reason: error instanceof Error ? error.message : "unknown_error"
    })
    return safeJsonError("Payments are unavailable right now.", 500)
  }
}
