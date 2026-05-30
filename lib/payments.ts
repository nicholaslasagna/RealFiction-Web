import "server-only"

import { z } from "zod"

import type { CheckoutLine } from "@/lib/store-server"

export const checkoutSchema = z.object({
  provider: z.enum(["stripe", "paypal"]),
  minecraftUsername: z.string().trim().min(3).max(16).regex(/^[A-Za-z0-9_]+$/).optional(),
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
  minecraftUsername?: string | null
  giftRecipient?: string | null
}

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://realfiction.live"
}

export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

export function isPayPalConfigured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET)
}

export async function createStripeCheckout(order: CheckoutOrder, lines: CheckoutLine[]) {
  const secret = process.env.STRIPE_SECRET_KEY
  const siteUrl = getSiteUrl()

  if (!secret) {
    throw new Error("Stripe is not configured.")
  }

  const body = new URLSearchParams()
  body.set("mode", "payment")
  body.set("client_reference_id", order.id)
  body.set("success_url", `${siteUrl}/account?checkout=success&order_id=${order.id}`)
  body.set("cancel_url", `${siteUrl}/store?checkout=cancelled&order_id=${order.id}`)
  body.set("metadata[network]", "RealFiction")
  body.set("metadata[order_id]", order.id)
  body.set("metadata[minecraft_username]", order.minecraftUsername ?? "")
  body.set("metadata[gift_recipient]", order.giftRecipient ?? "")
  body.set("payment_intent_data[metadata][order_id]", order.id)
  body.set("payment_intent_data[metadata][network]", "RealFiction")

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

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  })

  if (!response.ok) {
    throw new Error("Stripe checkout session could not be created.")
  }

  const session = (await response.json()) as { url?: string; id?: string }

  return {
    checkoutUrl: session.url ?? null,
    providerSessionId: session.id ?? null
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
  const siteUrl = getSiteUrl()
  const token = await getPayPalAccessToken()
  const baseUrl = getPayPalBaseUrl()
  const totalCents = lines.reduce((total, item) => total + item.lineTotalCents, 0)

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
            value: (totalCents / 100).toFixed(2),
            breakdown: {
              item_total: {
                currency_code: "USD",
                value: (totalCents / 100).toFixed(2)
              }
            }
          },
          items: lines.map((line) => ({
            name: line.product.name,
            sku: line.product.slug,
            quantity: String(line.quantity),
            category: "DIGITAL_GOODS",
            unit_amount: {
              currency_code: line.product.currency,
              value: (line.product.price_cents / 100).toFixed(2)
            }
          }))
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
