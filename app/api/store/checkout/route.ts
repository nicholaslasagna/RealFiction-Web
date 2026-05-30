import {
  createPayPalCheckout,
  createStripeCheckout,
  checkoutSchema
} from "@/lib/payments"
import { paymentReadiness } from "@/lib/payment-readiness"
import { safeJsonError } from "@/lib/security"
import { getAuthenticatedUser } from "@/lib/supabase/server"
import {
  attachProviderSession,
  cancelOrder,
  createPendingOrder,
  resolveCheckoutLines
} from "@/lib/store-server"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = checkoutSchema.safeParse(body)

  if (!parsed.success) {
    return Response.json({ error: "Something in your cart does not look right." }, { status: 400 })
  }

  // Boolean-only readiness snapshot. Never contains secret values — only
  // presence flags — so it is safe to emit to server logs. Confirms that Stripe
  // can be ready even when PayPal is not configured, and that the Supabase
  // service-role / site URL the checkout flow depends on are present.
  const readiness = paymentReadiness()
  console.info("checkout_readiness", { provider: parsed.data.provider, ...readiness })

  if (parsed.data.provider === "stripe" && !readiness.stripe) {
    return safeJsonError("Card payments are not ready yet.", 503)
  }

  if (parsed.data.provider === "paypal" && !readiness.paypal) {
    return safeJsonError("PayPal payments are not ready yet.", 503)
  }

  // Tracks which stage we reached so a failure log pinpoints the exact step
  // (product resolution vs. order creation vs. the provider API) instead of the
  // generic catch-all. Values are static labels — no user or secret data.
  let step = "init"

  try {
    step = "authenticate"
    const user = await getAuthenticatedUser().catch(() => null)

    if (!user && !parsed.data.minecraftUsername && !parsed.data.giftRecipient) {
      return safeJsonError("A Minecraft username or signed-in account is required for checkout.", 400)
    }

    step = "resolve_products"
    const lines = await resolveCheckoutLines(parsed.data)

    step = "create_order"
    const orderId = await createPendingOrder(parsed.data, lines, user)

    step = parsed.data.provider === "stripe" ? "stripe_session" : "paypal_order"
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
      console.error("checkout_failed", {
        provider: parsed.data.provider,
        step,
        reason: "provider_returned_no_checkout_url"
      })
      return safeJsonError("We could not start payment yet. Please try again.", 502)
    }

    step = "attach_session"
    await attachProviderSession(orderId, result.providerSessionId)

    return Response.json({
      checkoutUrl: result.checkoutUrl,
      orderId
    })
  } catch (error) {
    // Reason is the thrown Error message (a static, secret-free label such as
    // "Unknown or inactive product." or "Stripe checkout session could not be
    // created (status 401, ...)."). Combined with `step`, this identifies the
    // exact failing stage without exposing any secret value.
    console.error("checkout_failed", {
      provider: parsed.data.provider,
      step,
      reason: error instanceof Error ? error.message : "unknown_error"
    })
    return safeJsonError("Payments are unavailable right now.", 500)
  }
}
