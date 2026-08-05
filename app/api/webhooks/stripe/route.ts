// Canonical Stripe webhook endpoint: https://realfiction.live/api/webhooks/stripe
//
// This is the ONLY Stripe webhook route. Do not add an alias path — a second
// endpoint would double-deliver events and split the dedupe ledger.
//
// Guarantees preserved here (do not weaken):
//   * raw body read BEFORE parsing, for signature verification
//   * constant-time signature compare with a 300s replay tolerance
//   * event deduplication by Stripe event id
//   * fast 2xx; fulfilment is queued, never waits on a Minecraft server
import {
  constantTimeEqual,
  safeJsonError
} from "@/lib/security"
import {
  checkLivemode,
  classifyRefundScope,
  classifyStripeEvent,
  resolveStripeEnvironment,
  type StripeEventLike
} from "@/lib/stripe-events"
import {
  claimPaymentRevocation,
  findOrderIdByPaymentId,
  getOrderPaymentContext,
  markOrderPaidAndFulfill,
  markOrderUnpaidClosed,
  markWebhookEventProcessed,
  persistWebhookEvent,
  recordPaymentReview,
  releaseStoreCredit,
  revokeOrder
} from "@/lib/store-server"

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

/**
 * Resolves the internal order for a refund/dispute from trusted server records.
 * Event metadata is only a hint; the PaymentIntent recorded on the order at
 * fulfilment time is the authority.
 */
async function resolveOrderId(
  paymentIntentId: string | null,
  object: Record<string, unknown>
): Promise<string | null> {
  const metadata = (object.metadata ?? {}) as Record<string, string | undefined>
  if (paymentIntentId) {
    const fromPayment = await findOrderIdByPaymentId("stripe", paymentIntentId)
    if (fromPayment) {
      return fromPayment
    }
  }
  return typeof metadata.order_id === "string" && metadata.order_id ? metadata.order_id : null
}

export async function POST(request: Request) {
  const payload = await request.text()
  const verified = await verifyStripeSignature(request, payload)

  if (!verified) {
    return Response.json({ error: "Invalid webhook signature." }, { status: 401 })
  }

  let event: StripeEventLike

  try {
    event = JSON.parse(payload)
  } catch {
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 })
  }

  if (!event.id || !event.type) {
    return Response.json({ error: "Invalid webhook event." }, { status: 400 })
  }

  // Environment separation. Fails closed when STRIPE_ENVIRONMENT is missing or
  // unrecognised, so a test-mode event can never mutate production orders.
  const environment = resolveStripeEnvironment(process.env.STRIPE_ENVIRONMENT)
  const livemode = checkLivemode(event, environment)

  if (!livemode.ok) {
    // 202: signature was valid, so this is a real Stripe delivery for the wrong
    // environment. Returning 2xx stops Stripe retrying forever; we simply do no
    // work. The reason is a fixed enum string, never a secret.
    console.warn("stripe_webhook_environment_rejected", {
      event_type: event.type,
      reason: livemode.reason
    })
    return Response.json({ received: true, ignored: livemode.reason }, { status: 202 })
  }

  try {
    const persisted = await persistWebhookEvent("stripe", event.id, event.type, event)

    if (persisted.duplicate && persisted.alreadyProcessed) {
      return Response.json({ received: true, duplicate: true })
    }

    const action = classifyStripeEvent(event)
    const object = (event.data?.object ?? {}) as Record<string, unknown>

    switch (action.kind) {
      case "fulfill": {
        await markOrderPaidAndFulfill(action.orderId, action.paymentIntentId)
        break
      }

      case "await_async_payment": {
        // Delayed payment method still processing: keep the pending order and
        // the reserved store credit untouched until async_payment_succeeded.
        console.info("stripe_awaiting_async_payment", { order_id: action.orderId })
        break
      }

      case "release": {
        // Release the credit hold first, then close the order. Both are
        // idempotent, and release_store_credit_for_order writes an
        // exactly-once ledger entry keyed by order id.
        await releaseStoreCredit(action.orderId)
        await markOrderUnpaidClosed(action.orderId, action.reason)
        break
      }

      case "revoke": {
        const orderId = action.orderId ?? (await resolveOrderId(action.paymentIntentId, object))

        if (!orderId) {
          await recordPaymentReview({
            providerEventId: event.id,
            eventType: event.type,
            reason: "order_not_found",
            paymentIntentId: action.paymentIntentId,
            detail: { mode: action.mode }
          })
          break
        }

        if (action.mode === "refund") {
          // Only a full refund may auto-revoke. A partial refund is recorded
          // for a human: revoke_order revokes the WHOLE order, which would take
          // away access the customer still paid for.
          const context = await getOrderPaymentContext(orderId)
          const amount = Number(object.amount ?? 0)
          const scope = classifyRefundScope(amount, context?.paidCents ?? null, context?.items ?? [])

          if (scope.kind !== "full") {
            await recordPaymentReview({
              providerEventId: event.id,
              eventType: event.type,
              reason: scope.kind === "partial" ? "partial_refund" : "refund_scope_unknown",
              orderId,
              paymentIntentId: action.paymentIntentId,
              detail: {
                refunded_amount_cents: amount,
                order_paid_cents: context?.paidCents ?? null,
                unambiguous_order_item_id:
                  scope.kind === "partial" ? scope.unambiguousOrderItemId : null
              }
            })
            break
          }
        }

        // Durable operation key from the refund/dispute OBJECT id. Stripe sends
        // several event ids for one refund (created, then updated…), so event-id
        // dedupe alone would revoke the same order more than once.
        if (action.operationKey) {
          const claimed = await claimPaymentRevocation({
            operationKey: action.operationKey,
            orderId,
            mode: action.mode,
            reason: action.reason
          })

          if (!claimed) {
            console.info("stripe_revocation_already_applied", {
              order_id: orderId,
              operation_key: action.operationKey
            })
            break
          }
        }

        await revokeOrder(orderId, action.mode, action.reason)
        await recordPaymentReview({
          providerEventId: event.id,
          eventType: event.type,
          reason: `revoked:${action.mode}`,
          orderId,
          paymentIntentId: action.paymentIntentId,
          detail: { mode: action.mode, operation_key: action.operationKey }
        })
        break
      }

      case "manual_review": {
        const orderId = await resolveOrderId(action.paymentIntentId, object)
        await recordPaymentReview({
          providerEventId: event.id,
          eventType: event.type,
          reason: action.reason,
          orderId,
          paymentIntentId: action.paymentIntentId,
          detail: action.detail
        })
        break
      }

      case "record_only": {
        const orderId = await resolveOrderId(
          typeof object.payment_intent === "string" ? object.payment_intent : null,
          object
        )
        await recordPaymentReview({
          providerEventId: event.id,
          eventType: event.type,
          reason: action.reason,
          orderId,
          paymentIntentId: typeof object.payment_intent === "string" ? object.payment_intent : null,
          detail: { status: object.status ?? null }
        })
        break
      }

      case "ignore": {
        console.info("stripe_webhook_ignored", { event_type: event.type, reason: action.reason })
        break
      }
    }

    await markWebhookEventProcessed("stripe", event.id)

    return Response.json({ received: true })
  } catch (error) {
    console.error("stripe_webhook_error", error)
    return safeJsonError("Webhook could not be processed.", 500)
  }
}
