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
  enqueuePartialRefundOutbox,
  findOrderIdByPaymentId,
  getOrderExpectation,
  getOrderPaymentContext,
  markOrderUnpaidClosed,
  markWebhookEventProcessed,
  persistWebhookEvent,
  recordPaymentReview,
  releaseStoreCredit,
  revokeOrderWithRefundOutbox
} from "@/lib/store-server"
import { verifyPaymentFacts, type VerifiedPaymentFacts } from "@/lib/store/payment-facts"
import { fulfilVerifiedPayment } from "@/lib/store/fulfil-verified-payment"
import {
  giftCardForOrder,
  handleGiftCardDisputeClosed,
  handleGiftCardDisputeCreated,
  handleGiftCardRefundEvent
} from "@/lib/gift-card/refunds"

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

/**
 * Stripe puts the hosted receipt URL on the charge, not the session. Snapshot
 * payloads may inline the latest charge; when they do not, we simply store
 * nothing and the order page/email omit the receipt link.
 */
function readChargeId(object: Record<string, unknown>): string | null {
  const intent = object.payment_intent
  if (intent && typeof intent === "object") {
    const charge = (intent as Record<string, unknown>).latest_charge
    if (typeof charge === "string" && charge) {
      return charge
    }
    if (charge && typeof charge === "object") {
      const id = (charge as Record<string, unknown>).id
      if (typeof id === "string" && id) {
        return id
      }
    }
  }
  const direct = object.id
  return typeof direct === "string" && direct.startsWith("ch_") ? direct : null
}

function readReceiptUrl(object: Record<string, unknown>): string | null {
  const direct = object.receipt_url
  if (typeof direct === "string" && direct) {
    return direct
  }
  const intent = object.payment_intent
  if (intent && typeof intent === "object") {
    const charge = (intent as Record<string, unknown>).latest_charge
    if (charge && typeof charge === "object") {
      const url = (charge as Record<string, unknown>).receipt_url
      if (typeof url === "string" && url) {
        return url
      }
    }
  }
  return null
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
        // Authenticity was settled above by the HMAC signature. What is settled
        // HERE is whether the money Stripe describes is the money we asked for.
        // The same gate runs in reconciliation, over facts it established by
        // pulling the session with our own secret key — neither path can
        // impersonate the other, and both must clear the same bar.
        const expectation = await getOrderExpectation(action.orderId)

        if (!expectation) {
          await recordPaymentReview({
            providerEventId: event.id,
            eventType: event.type,
            reason: "fulfillment_order_not_found",
            orderId: action.orderId,
            paymentIntentId: action.paymentIntentId
          })
          break
        }

        const facts: VerifiedPaymentFacts = {
          orderId: action.orderId,
          provider: "stripe",
          sessionId: typeof object.id === "string" && object.id.startsWith("cs_") ? object.id : null,
          paymentIntentId: action.paymentIntentId,
          chargeId: readChargeId(object),
          receiptUrl: readReceiptUrl(object),
          amountPaidCents: Number(object.amount_total ?? Number.NaN),
          currency: typeof object.currency === "string" ? object.currency : expectation.currency,
          paymentStatus: typeof object.payment_status === "string" ? object.payment_status : "",
          liveMode: environment === "live",
          evidence: { kind: "webhook", providerEventId: event.id }
        }

        const gate = verifyPaymentFacts(facts, expectation)

        if (!gate.ok) {
          // FAIL CLOSED. A signed event that disagrees with our own order about
          // the amount, currency, session, or environment is a contradiction, not
          // a payment. Retrying cannot resolve it, so this records a review and
          // returns 2xx rather than making Stripe redeliver forever. Nothing is
          // granted and no financial hold is released.
          console.warn("stripe_fulfillment_facts_rejected", {
            order_id: action.orderId,
            reason: gate.reason
          })
          await recordPaymentReview({
            providerEventId: event.id,
            eventType: event.type,
            reason: `fulfillment_facts_${gate.reason}`,
            orderId: action.orderId,
            paymentIntentId: action.paymentIntentId,
            detail: { priority: "high", check: gate.reason }
          })
          break
        }

        // Past the shared gate, fulfilment becomes product-specific. A gift
        // card issues stored value and queues two emails; everything else
        // grants entitlements and queues a RealCore reward. Both are one
        // transaction, both are idempotent, and both throw on failure so Stripe
        // redelivers rather than receiving a 2xx that lost the work.
        // Reconciliation calls this SAME function, never a copy of it. Each
        // path establishes authenticity its own way — signature here, an
        // authenticated pull there — and then they converge completely.
        await fulfilVerifiedPayment(
          action.orderId,
          {
            paymentIntentId: facts.paymentIntentId,
            chargeId: facts.chargeId,
            receiptUrl: facts.receiptUrl
          },
          process.env
        )
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

        // ---- GIFT-CARD DISPATCH, BEFORE ANY ORDINARY REVOCATION ----------
        // `revoke_order` reverses entitlements and queues RealCore rewards. A
        // gift card has neither, and is `consumable`, so it would do almost
        // nothing — crucially it would NOT invalidate the claim credential,
        // void the card, or reverse the stored value. Refunding a claimed card
        // through it returns the money and leaves the credit spendable.
        //
        // Classification asks the DATABASE which card this order issued, never
        // event metadata, and FAILS CLOSED: if we cannot tell, the ordinary
        // path must not run.
        if (orderId) {
          const giftCardId = await giftCardForOrder(orderId)

          if (giftCardId) {
            const amount = Number(object.amount ?? 0)

            if (event.type === "charge.dispute.closed") {
              // A LOST closure classifies as `revoke`/chargeback, same as a new
              // dispute — so type must be checked here or a closure would be
              // handled as a fresh dispute and never resolve the freeze.
              await handleGiftCardDisputeClosed({
                giftCardId,
                providerEventId: event.id,
                status: typeof object.status === "string" ? object.status : "lost"
              })
            } else if (action.mode === "chargeback") {
              await handleGiftCardDisputeCreated({
                giftCardId,
                providerEventId: event.id,
                disputedCents: Number.isFinite(amount) ? amount : 0
              })
            } else if (typeof object.id === "string" && object.id) {
              await handleGiftCardRefundEvent({
                giftCardId,
                providerRefundId: object.id,
                refundedCents: Number.isFinite(amount) ? amount : 0
              })
            }

            await markWebhookEventProcessed("stripe", event.id)
            return Response.json({ received: true, gift_card: true })
          }
        }

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
          const refundCurrency =
            typeof object.currency === "string" ? object.currency.toUpperCase() : "USD"

          // A refund denominated in a currency this order was never priced in
          // cannot be measured against it. Comparing the numbers anyway would
          // treat 1700 JPY as a full refund of a $17.00 charge.
          if (context && refundCurrency !== context.currency.toUpperCase()) {
            await recordPaymentReview({
              providerEventId: event.id,
              eventType: event.type,
              reason: "refund_currency_mismatch",
              orderId,
              paymentIntentId: action.paymentIntentId,
              detail: { priority: "high", refund_currency: refundCurrency, order_currency: context.currency }
            })
            break
          }

          const scope = classifyRefundScope(amount, context?.paidCents ?? null, context?.items ?? [])

          if (scope.kind !== "full") {
            // A genuine PARTIAL refund: access is untouched pending human
            // review, and the customer still gets told their money is coming
            // back. An UNKNOWN scope gets no email at all — the amount is one we
            // could not reconcile against the charge (above it, zero, negative,
            // or unmeasurable), and telling a customer "$17.01 is on its way"
            // on the strength of a number we do not believe is worse than
            // silence plus a human.
            if (scope.kind === "partial" && action.mode === "refund" && typeof object.id === "string") {
              await enqueuePartialRefundOutbox({
                orderId,
                refundId: object.id,
                refundedCents: amount,
                currency: refundCurrency,
                affectedItemName: null
              })
            }
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

        // ONE transaction: claim the revocation (keyed on the refund/dispute
        // OBJECT id, since Stripe emits several event ids per refund), revoke,
        // and write the refund outbox row. Chargebacks pass no refund id — that
        // conversation belongs to the bank, so no customer mail is queued.
        const revocation = await revokeOrderWithRefundOutbox({
          orderId,
          operationKey: action.operationKey ?? `${action.mode}:${orderId}`,
          mode: action.mode,
          reason: action.reason,
          refundId: action.mode === "refund" && typeof object.id === "string" ? object.id : null,
          refundedCents: Number(object.amount ?? 0),
          currency: typeof object.currency === "string" ? object.currency.toUpperCase() : "USD",
          isFullRefund: true,
          entitlementStatus: "revoked"
        })

        if (!revocation.claimed) {
          console.info("stripe_revocation_already_applied", {
            order_id: orderId,
            operation_key: action.operationKey
          })
          break
        }

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

        // A dispute CLOSING on a gift-card purchase decides whether the frozen
        // value comes back. Only an authoritative win unfreezes.
        if (orderId && action.reason.startsWith("dispute_closed")) {
          const giftCardId = await giftCardForOrder(orderId)
          if (giftCardId) {
            await handleGiftCardDisputeClosed({
              giftCardId,
              providerEventId: event.id,
              status: typeof object.status === "string" ? object.status : null
            })
            await markWebhookEventProcessed("stripe", event.id)
            return Response.json({ received: true, gift_card: true })
          }
        }
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
