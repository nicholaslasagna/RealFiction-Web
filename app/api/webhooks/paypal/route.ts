import { getPayPalAccessToken, getPayPalBaseUrl } from "@/lib/payments"
import { safeJsonError } from "@/lib/security"
import {
  markOrderPaidAndFulfill,
  markWebhookEventProcessed,
  persistWebhookEvent
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
      }
    }
    purchase_units?: Array<{
      reference_id?: string
      custom_id?: string
    }>
  }
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

    await markWebhookEventProcessed("paypal", payload.id)

    return Response.json({ received: true })
  } catch (error) {
    console.error("paypal_webhook_error", error)
    return safeJsonError("Webhook could not be processed.", 500)
  }
}
