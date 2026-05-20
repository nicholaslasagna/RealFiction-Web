import {
  constantTimeEqual,
  safeJsonError
} from "@/lib/security"
import {
  findOrderIdByPaymentId,
  markOrderPaidAndFulfill,
  markWebhookEventProcessed,
  persistWebhookEvent,
  revokeOrder
} from "@/lib/store-server"

export const runtime = "edge"

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function parseStripeSignature(header: string) {
  return header.split(",").reduce(
    (parts, item) => {
      const [key, value] = item.split("=")

      if (key === "t") {
        parts.timestamp = value
      }

      if (key === "v1" && value) {
        parts.signatures.push(value)
      }

      return parts
    },
    { signatures: [] as string[], timestamp: "" }
  )
}

async function verifyStripeSignature(request: Request, payload: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  const header = request.headers.get("stripe-signature")

  if (!secret || !header) {
    return false
  }

  const { timestamp, signatures } = parseStripeSignature(header)
  const timestampNumber = Number(timestamp)
  const age = Math.abs(Date.now() / 1000 - timestampNumber)

  if (!timestamp || Number.isNaN(timestampNumber) || age > 300 || signatures.length === 0) {
    return false
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`)
  )
  const expected = toHex(signature)

  return signatures.some((candidate) => constantTimeEqual(candidate, expected))
}

export async function POST(request: Request) {
  const payload = await request.text()
  const verified = await verifyStripeSignature(request, payload)

  if (!verified) {
    return Response.json({ error: "Invalid webhook signature." }, { status: 401 })
  }

  let event: {
    id?: string
    type?: string
    data?: { object?: Record<string, unknown> }
  }

  try {
    event = JSON.parse(payload)
  } catch {
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 })
  }

  if (!event.id || !event.type) {
    return Response.json({ error: "Invalid webhook event." }, { status: 400 })
  }

  try {
    const persisted = await persistWebhookEvent("stripe", event.id, event.type, event)

    if (persisted.duplicate && persisted.alreadyProcessed) {
      return Response.json({ received: true, duplicate: true })
    }

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data?.object ?? {}
      const metadata = (session.metadata ?? {}) as Record<string, string | undefined>
      const orderId =
        metadata.order_id ??
        (typeof session.client_reference_id === "string" ? session.client_reference_id : undefined)
      const paymentStatus = typeof session.payment_status === "string" ? session.payment_status : undefined
      const status = typeof session.status === "string" ? session.status : undefined

      if (orderId && (paymentStatus === "paid" || status === "complete")) {
        await markOrderPaidAndFulfill(
          orderId,
          typeof session.payment_intent === "string" ? session.payment_intent : null
        )
      }
    }

    if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
      const object = (event.data?.object ?? {}) as Record<string, unknown>
      const metadata = (object.metadata ?? {}) as Record<string, string | undefined>
      const paymentIntent = typeof object.payment_intent === "string" ? object.payment_intent : null
      const orderId =
        metadata.order_id ?? (paymentIntent ? await findOrderIdByPaymentId("stripe", paymentIntent) : null)
      const mode = event.type === "charge.dispute.created" ? "chargeback" : "refund"

      if (orderId) {
        await revokeOrder(orderId, mode, `stripe:${event.type}`)
      }
    }

    await markWebhookEventProcessed("stripe", event.id)

    return Response.json({ received: true })
  } catch (error) {
    console.error("stripe_webhook_error", error)
    return safeJsonError("Webhook could not be processed.", 500)
  }
}
