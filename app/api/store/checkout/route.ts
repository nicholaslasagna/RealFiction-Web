import {
  createPayPalCheckout,
  createStripeCheckout,
  checkoutSchema,
  isPayPalConfigured,
  isStripeConfigured
} from "@/lib/payments"
import { safeJsonError } from "@/lib/security"
import { getAuthenticatedUser } from "@/lib/supabase/server"
import {
  attachProviderSession,
  cancelOrder,
  createPendingOrder,
  resolveCheckoutLines
} from "@/lib/store-server"

export const runtime = "edge"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = checkoutSchema.safeParse(body)

  if (!parsed.success) {
    return Response.json({ error: "Invalid checkout payload." }, { status: 400 })
  }

  if (parsed.data.provider === "stripe" && !isStripeConfigured()) {
    return safeJsonError("Stripe checkout is not configured yet.", 503)
  }

  if (parsed.data.provider === "paypal" && !isPayPalConfigured()) {
    return safeJsonError("PayPal checkout is not configured yet.", 503)
  }

  try {
    const user = await getAuthenticatedUser().catch(() => null)

    if (!user && !parsed.data.minecraftUsername && !parsed.data.giftRecipient) {
      return safeJsonError("A Minecraft username or signed-in account is required for checkout.", 400)
    }

    const lines = await resolveCheckoutLines(parsed.data)
    const orderId = await createPendingOrder(parsed.data, lines, user)
    const result =
      parsed.data.provider === "stripe"
        ? await createStripeCheckout(
            {
              id: orderId,
              provider: "stripe",
              minecraftUsername: parsed.data.minecraftUsername,
              giftRecipient: parsed.data.giftRecipient
            },
            lines
          )
        : await createPayPalCheckout(
            {
              id: orderId,
              provider: "paypal",
              minecraftUsername: parsed.data.minecraftUsername,
              giftRecipient: parsed.data.giftRecipient
            },
            lines
          )

    if (!result.checkoutUrl) {
      await cancelOrder(orderId)
      return safeJsonError("Checkout session could not be created.", 502)
    }

    await attachProviderSession(orderId, result.providerSessionId)

    return Response.json({
      checkoutUrl: result.checkoutUrl,
      orderId
    })
  } catch (error) {
    console.error("checkout_error", error)
    return safeJsonError("Checkout is unavailable right now.", 500)
  }
}
