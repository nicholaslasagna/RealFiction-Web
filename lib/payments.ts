import "server-only"

import { z } from "zod"

import type { CheckoutLine } from "@/lib/store-server"
import { isPayPalAllowed, stripeSessionExpiresAt } from "@/lib/checkout-guard"
import { isPayPalConfigured, isStripeConfigured } from "@/lib/payment-readiness"

// Re-exported so existing importers (`@/lib/payments`) keep working. The real
// definitions live in the server-only-free readiness module so they can be unit
// tested. Stripe readiness is independent of PayPal.
export { isPayPalConfigured, isStripeConfigured }

export const checkoutSchema = z.object({
  provider: z.enum(["stripe", "paypal"]),
  // Client-generated identity for ONE checkout intent, reused across retries of
  // that intent. Required: without it two clicks become two payable Stripe
  // sessions. It is an identity only — the server binds it to the authenticated
  // account and the canonical resolved cart before it means anything.
  checkoutAttemptId: z
    .string()
    .trim()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      "checkoutAttemptId must be a UUID"
    ),
  /**
   * Request an upgrade rather than a fresh purchase.
   *
   * This is a REQUEST, never an amount. The server recomputes eligibility and
   * the discounted price from entitlements and settled orders; a client that
   * sets this for an ineligible cart is simply charged full price (or refused),
   * and can never name its own discount.
   */
  requestUpgrade: z.boolean().optional().default(false),
  // Gift mode is an explicit flag (a checkbox in the cart). For a normal
  // purchase the delivery target is the buyer's linked account, resolved on the
  // server — the client never sends its own username for non-gift orders.
  isGift: z.boolean().optional().default(false),
  // Whether to spend the buyer's store credit. The amount applied is always
  // computed server-side from the ledger — the client never sends a balance.
  applyStoreCredit: z.boolean().optional().default(false),
  giftRecipient: z.string().trim().min(3).max(16).regex(/^[A-Za-z0-9_]+$/).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/),
        quantity: z.number().int().min(1).max(25)
      })
    )
    .min(1)
    .max(25)
})

export type CheckoutInput = z.infer<typeof checkoutSchema>

type CheckoutOrder = {
  id: string
  provider: "stripe" | "paypal"
  /**
   * The buyer's account email. Passed to Stripe as `receipt_email` so Stripe
   * sends its own payment receipt on a successful charge — and only then;
   * Stripe never emails a receipt for an unpaid or failed session.
   */
  buyerEmail?: string | null
  // Resolved server-side delivery target (gift recipient for gifts, the buyer's
  // linked Minecraft account otherwise). Non-empty for any valid checkout.
  minecraftUsername?: string | null
  giftRecipient?: string | null
  isGift?: boolean
  // Store credit applied to this order + the remaining amount the provider
  // should charge (cents). When credit is applied the session bills only the
  // remainder via a single consolidated line item.
  storeCreditAppliedCents?: number
  paymentDueCents?: number
  /** Server-computed upgrade discount (cents). Never client-supplied. */
  discountCents?: number
}

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://realfiction.live"
}

/**
 * Stripe API version pinned for OUTGOING requests, matching the version the
 * production event destination uses for incoming Snapshot payloads. The project
 * uses no Stripe SDK, so this header is the only version contract there is.
 */
export const STRIPE_API_VERSION = "2026-04-22.dahlia"

export async function createStripeCheckout(order: CheckoutOrder, lines: CheckoutLine[]) {
  const secret = process.env.STRIPE_SECRET_KEY
  const siteUrl = getSiteUrl()

  if (!secret) {
    throw new Error("Stripe is not configured.")
  }

  const body = new URLSearchParams()
  body.set("mode", "payment")
  body.set("client_reference_id", order.id)
  if (order.buyerEmail) {
    // Prefills Checkout AND is the address Stripe sends the receipt to.
    body.set("customer_email", order.buyerEmail)
    body.set("payment_intent_data[receipt_email]", order.buyerEmail)
  }
  // Explicit, bounded session lifetime, matched to the internal attempt TTL.
  // Without this the session would outlive the attempt and could still be paid
  // after we consider the checkout dead. `after_expiration.recovery` is
  // deliberately NOT enabled: a recovery URL is a second payable link created
  // outside our attempt lock.
  body.set("expires_at", String(stripeSessionExpiresAt(Date.now())))
  body.set("success_url", `${siteUrl}/account?checkout=success&order_id=${order.id}`)
  body.set("cancel_url", `${siteUrl}/store?checkout=cancelled&order_id=${order.id}`)
  body.set("metadata[network]", "RealFiction")
  body.set("metadata[order_id]", order.id)
  body.set("metadata[minecraft_username]", order.minecraftUsername ?? "")
  body.set("metadata[gift_recipient]", order.giftRecipient ?? "")
  body.set("metadata[is_gift]", order.isGift ? "true" : "false")
  body.set("metadata[store_credit_cents]", String(order.storeCreditAppliedCents ?? 0))
  body.set("payment_intent_data[metadata][order_id]", order.id)
  body.set("payment_intent_data[metadata][network]", "RealFiction")

  const storeCreditApplied = (order.storeCreditAppliedCents ?? 0) > 0
  const discountApplied = (order.discountCents ?? 0) > 0

  if (storeCreditApplied || discountApplied) {
    // Store credit and/or an upgrade discount reduce what Stripe charges, so
    // the session bills ONE consolidated line for the amount actually due.
    // Per-line pricing here would charge the undiscounted list price. The DB
    // order_items still carry the real products, so fulfilment is unchanged.
    const dueCents = order.paymentDueCents ?? lines.reduce((total, item) => total + item.lineTotalCents, 0)
    body.set("metadata[payment_due_cents]", String(dueCents))
    body.set("line_items[0][quantity]", "1")
    body.set("line_items[0][price_data][currency]", "usd")
    body.set("line_items[0][price_data][unit_amount]", String(dueCents))
    body.set(
      "line_items[0][price_data][product_data][name]",
      discountApplied ? "RealFiction upgrade" : "RealFiction order (store credit applied)"
    )
    body.set("line_items[0][price_data][product_data][metadata][store_credit_applied]", String(storeCreditApplied))
    body.set("line_items[0][price_data][product_data][metadata][upgrade_discount_cents]", String(order.discountCents ?? 0))
  } else {
    lines.forEach((item, index) => {
      body.set(`line_items[${index}][quantity]`, String(item.quantity))
      body.set(`line_items[${index}][price_data][currency]`, item.product.currency.toLowerCase())
      body.set(`line_items[${index}][price_data][unit_amount]`, String(item.product.price_cents))
      body.set(`line_items[${index}][price_data][product_data][name]`, item.product.name)
      body.set(`line_items[${index}][price_data][product_data][description]`, item.product.description)
      body.set(`line_items[${index}][price_data][product_data][metadata][product_id]`, item.product.id)
      body.set(`line_items[${index}][price_data][product_data][metadata][product_slug]`, item.product.slug)
      body.set(`line_items[${index}][price_data][product_data][metadata][category]`, item.product.category)
    })
  }

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
      // Pin the request version to the same one the webhook destination sends
      // (Snapshot payloads, 2026-04-22.dahlia) instead of inheriting whatever
      // the account default happens to be — an account-level version change
      // must never silently reshape checkout responses.
      "Stripe-Version": STRIPE_API_VERSION,
      // Deterministic per order: a double-click, a retry, or a resumed attempt
      // replays the ORIGINAL session (same URL) instead of creating a second
      // one. Scoped to our order id so unrelated carts never collide.
      "Idempotency-Key": `realfiction-checkout:${order.id}`
    },
    body
  })

  if (!response.ok) {
    // Stripe error bodies never contain our secret key. We surface only the
    // machine-readable type/code (e.g. "invalid_request_error" /
    // "amount_too_small", "api_key_expired") and HTTP status — never the human
    // `message`, which can echo a redacted key fragment.
    let code = "unknown"
    let type = "unknown"
    try {
      const payload = (await response.json()) as {
        error?: { code?: string; type?: string }
      }
      code = payload.error?.code ?? code
      type = payload.error?.type ?? type
    } catch {
      // Non-JSON body — keep the defaults.
    }
    console.error("stripe_session_error", { status: response.status, type, code })
    throw new Error(
      `Stripe checkout session could not be created (status ${response.status}, ${type}/${code}).`
    )
  }

  const session = (await response.json()) as { url?: string; id?: string; expires_at?: number }

  return {
    checkoutUrl: session.url ?? null,
    providerSessionId: session.id ?? null,
    // Stripe echoes the authoritative expiry; store it rather than our own
    // estimate so reuse decisions follow Stripe's clock.
    sessionExpiresAt:
      typeof session.expires_at === "number" ? new Date(session.expires_at * 1000).toISOString() : null
  }
}

export async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error("PayPal is not configured.")
  }

  const baseUrl = getPayPalBaseUrl()
  const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  })

  if (!tokenResponse.ok) {
    throw new Error("PayPal access token could not be created.")
  }

  const token = (await tokenResponse.json()) as { access_token?: string }

  if (!token.access_token) {
    throw new Error("PayPal access token response was invalid.")
  }

  return token.access_token
}

export function getPayPalBaseUrl() {
  // Live only when explicitly opted in. Accept "production" or "live" (any
  // case) so the eventual go-live flip can't silently stay in sandbox because
  // of a near-miss value like "live" or "Production" — anything else is sandbox.
  const environment = (process.env.PAYPAL_ENVIRONMENT ?? "").trim().toLowerCase()
  const live = environment === "production" || environment === "live"
  return live ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"
}

export async function createPayPalCheckout(order: CheckoutOrder, lines: CheckoutLine[]) {
  // Hard server-side stop: PayPal is sandbox-only and must be unreachable in
  // production even if a client posts provider=paypal directly. Throwing here
  // (rather than deleting the module) keeps sandbox development and historical
  // PayPal order records intact.
  if (!isPayPalAllowed()) {
    throw new Error("PayPal checkout is disabled in this environment.")
  }

  const siteUrl = getSiteUrl()
  const token = await getPayPalAccessToken()
  const baseUrl = getPayPalBaseUrl()
  const totalCents = lines.reduce((total, item) => total + item.lineTotalCents, 0)
  const storeCreditApplied = (order.storeCreditAppliedCents ?? 0) > 0
  const chargeValue = ((storeCreditApplied ? (order.paymentDueCents ?? totalCents) : totalCents) / 100).toFixed(2)
  // When credit is applied, bill only the remainder via one consolidated item;
  // the DB order_items still carry the real products for fulfillment.
  const items = storeCreditApplied
    ? [
        {
          name: "RealFiction order (store credit applied)",
          sku: order.id,
          quantity: "1",
          category: "DIGITAL_GOODS",
          unit_amount: { currency_code: "USD", value: chargeValue }
        }
      ]
    : lines.map((line) => ({
        name: line.product.name,
        sku: line.product.slug,
        quantity: String(line.quantity),
        category: "DIGITAL_GOODS",
        unit_amount: {
          currency_code: line.product.currency,
          value: (line.product.price_cents / 100).toFixed(2)
        }
      }))

  const orderResponse = await fetch(`${baseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: order.id,
          custom_id: order.id,
          invoice_id: order.id,
          description: "RealFiction cosmetic and supporter checkout",
          amount: {
            currency_code: "USD",
            value: chargeValue,
            breakdown: {
              item_total: {
                currency_code: "USD",
                value: chargeValue
              }
            }
          },
          items
        }
      ],
      application_context: {
        return_url: `${siteUrl}/api/store/paypal/capture?order_id=${order.id}`,
        cancel_url: `${siteUrl}/store?checkout=cancelled&order_id=${order.id}`,
        brand_name: "RealFiction",
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING"
      }
    })
  })

  if (!orderResponse.ok) {
    throw new Error("PayPal order could not be created.")
  }

  const paypalOrder = (await orderResponse.json()) as {
    id?: string
    links?: Array<{ href: string; rel: string }>
  }

  return {
    checkoutUrl: paypalOrder.links?.find((link) => link.rel === "approve")?.href ?? null,
    providerSessionId: paypalOrder.id ?? null
  }
}

// PayPal order IDs are alphanumeric tokens (e.g. "5O190127TN364715T"). Anything
// else is rejected so a user-supplied value can never inject "/", "?", "..",
// etc. into the request path and redirect this authenticated call to a different
// PayPal API endpoint (SSRF / request forgery, CWE-918).
const PAYPAL_ORDER_ID_PATTERN = /^[A-Za-z0-9]{5,64}$/

export async function capturePayPalOrder(payPalOrderId: string) {
  if (!PAYPAL_ORDER_ID_PATTERN.test(payPalOrderId)) {
    throw new Error("Invalid PayPal order id.")
  }

  const token = await getPayPalAccessToken()
  const baseUrl = getPayPalBaseUrl()
  const response = await fetch(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(payPalOrderId)}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  })

  if (!response.ok) {
    throw new Error("PayPal order could not be captured.")
  }

  return (await response.json()) as {
    id?: string
    status?: string
    purchase_units?: Array<{
      reference_id?: string
      payments?: {
        captures?: Array<{ id?: string; status?: string }>
      }
    }>
  }
}
