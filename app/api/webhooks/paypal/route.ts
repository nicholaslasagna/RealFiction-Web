import { getPayPalAccessToken, getPayPalBaseUrl } from "@/lib/payments"
import { safeJsonError } from "@/lib/security"
import {
  findOrderIdByPaymentId,
  markOrderPaidAndFulfill,
  markWebhookEventProcessed,
  persistWebhookEvent,
  revokeOrder
} from "@/lib/store-server"

export const runtime = "edge"

async function verifyPayPalWebhook(request: Request, body: unknown) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID

  if (!webhookId) {
    return false
  }

  let accessToken: string

  try {
    accessToken = await getPayPalAccessToken()
  } catch {
    return false
  }

  const baseUrl = getPayPalBaseUrl()
  const response = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      auth_algo: request.headers.get("paypal-auth-algo"),
      cert_url: request.headers.get("paypal-cert-url"),
      transmission_id: request.headers.get("paypal-transmission-id"),
      transmission_sig: request.headers.get("paypal-transmission-sig"),
      transmission_time: request.headers.get("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: body
    })
  })

  if (!response.ok) {
    return false
  }

  const result = (await response.json()) as { verification_status?: string }

  return result.verification_status === "SUCCESS"
}

function getOrderIdFromPayPalEvent(payload: PayPalWebhookEvent) {
  const resource = payload.resource ?? {}
  const purchaseUnit = resource.purchase_units?.[0]

  return (
    resource.custom_id ??
    resource.invoice_id ??
    resource.supplementary_data?.related_ids?.order_id ??
    purchaseUnit?.custom_id ??
    purchaseUnit?.reference_id ??
    null
  )
}

type PayPalWebhookEvent = {
  id?: string
  event_type?: string
  resource?: {
    id?: string
    custom_id?: string
    invoice_id?: string
    status?: string
    supplementary_data?: {
      related_ids?: {
        order_id?: string
        capture_id?: string
      }
    }
    links?: Array<{ href?: string; rel?: string }>
    disputed_transactions?: Array<{ seller_transaction_id?: string }>
    purchase_units?: Array<{
      reference_id?: string
      custom_id?: string
    }>
  }
}

function getCaptureIdFromPayPalEvent(payload: PayPalWebhookEvent) {
  const resource = payload.resource ?? {}

  if (resource.supplementary_data?.related_ids?.capture_id) {
    return resource.supplementary_data.related_ids.capture_id
  }

  const sellerTxn = resource.disputed_transactions?.[0]?.seller_transaction_id
  if (sellerTxn) {
    return sellerTxn
  }

  const upLink = resource.links?.find((link) => link.rel === "up")?.href
  const match = upLink?.match(/\/captures\/([^/]+)$/)

  return match?.[1] ?? null
}

// A refund/reversal/dispute does not carry our local order id directly, so
// resolve it: prefer the custom_id/invoice_id we set on the purchase unit,
// otherwise map the originating capture id back to the stored order.
async function resolveRevokeOrderId(payload: PayPalWebhookEvent) {
  const resource = payload.resource ?? {}

  if (resource.custom_id) {
    return resource.custom_id
  }

  if (resource.invoice_id) {
    return resource.invoice_id
  }

  const captureId = getCaptureIdFromPayPalEvent(payload)

  return captureId ? findOrderIdByPaymentId("paypal", captureId) : null
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as PayPalWebhookEvent | null
  const verified = payload ? await verifyPayPalWebhook(request, payload) : false

  if (!verified) {
    return Response.json({ error: "Invalid webhook signature." }, { status: 401 })
  }

  if (!payload?.id || !payload.event_type) {
    return Response.json({ error: "Invalid webhook event." }, { status: 400 })
  }

  try {
    const persisted = await persistWebhookEvent("paypal", payload.id, payload.event_type, payload)

    if (persisted.duplicate && persisted.alreadyProcessed) {
      return Response.json({ received: true, duplicate: true })
    }

    if (payload.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const orderId = getOrderIdFromPayPalEvent(payload)

      if (orderId) {
        await markOrderPaidAndFulfill(orderId, payload.resource?.id ?? null)
      }
    }

    if (
      payload.event_type === "PAYMENT.CAPTURE.REFUNDED" ||
      payload.event_type === "PAYMENT.CAPTURE.REVERSED" ||
      payload.event_type === "CUSTOMER.DISPUTE.CREATED"
    ) {
      const orderId = await resolveRevokeOrderId(payload)
      const mode = payload.event_type === "PAYMENT.CAPTURE.REFUNDED" ? "refund" : "chargeback"

      if (orderId) {
        await revokeOrder(orderId, mode, `paypal:${payload.event_type}`)
      }
    }

    await markWebhookEventProcessed("paypal", payload.id)

    return Response.json({ received: true })
  } catch (error) {
    console.error("paypal_webhook_error", error)
    return safeJsonError("Webhook could not be processed.", 500)
  }
}
