import "server-only"

import { isGiftCardOrder, issueGiftCardForPaidOrder } from "@/lib/gift-card/fulfillment"
import { recordGiftCardPurchase } from "@/lib/abuse/purchases"
import { fulfillPaidOrderWithOutbox } from "@/lib/store-server"
import type { VerifiedPaymentFacts } from "@/lib/store/payment-facts"

/**
 * The single product-specific fulfilment dispatch, for callers that have
 * ALREADY verified payment facts.
 *
 * Two things reach this: the Stripe webhook, whose authority is an HMAC
 * signature, and reconciliation, whose authority is a Checkout Session pulled
 * with our own secret key. They establish authenticity differently and must
 * never be able to impersonate each other — but once each has independently
 * cleared `verifyPaymentFacts`, what happens next has to be identical, or the
 * recovered order differs from the webhook-fulfilled one in some way nobody
 * notices until a customer complains.
 *
 * So this exists to be shared, and it is deliberately thin: it decides WHICH
 * transaction to run, and runs it. It grants nothing itself. Every branch below
 * is one idempotent database transaction that throws on failure, so a caller
 * can retry rather than receiving a success that lost the work.
 *
 * Do not add a branch that partially fulfils, and do not add a "reconciliation
 * only" variant — a second path is the thing this prevents.
 */
export async function fulfilVerifiedPayment(
  orderId: string,
  facts: Pick<VerifiedPaymentFacts, "paymentIntentId" | "chargeId" | "receiptUrl">,
  env: Record<string, string | undefined>
): Promise<{ kind: "gift_card" | "ordinary" }> {
  // A gift card issues stored value and queues two emails. It must never reach
  // ordinary fulfilment, which would queue a RealCore reward for a product that
  // does not exist in game.
  if (await isGiftCardOrder(orderId)) {
    const issue = await issueGiftCardForPaidOrder(
      orderId,
      { paymentIntentId: facts.paymentIntentId, chargeId: facts.chargeId },
      env
    )

    // Counts the SUCCESSFUL purchase and its value toward the velocity ceilings.
    // Guarded on `issued` so a webhook and a reconciliation pass covering the
    // same order — which is the normal recovery case, not an edge case — do not
    // count it twice and push a real customer over a ceiling they never crossed.
    if (issue.issued) {
      await recordGiftCardPurchase(orderId)
    }
    return { kind: "gift_card" }
  }

  // Everything else: payment refs, entitlements, reward queue, store-credit
  // consumption, terminal status, and the confirmation outbox row — one
  // transaction. A replay finds the order terminal and changes nothing.
  await fulfillPaidOrderWithOutbox(orderId, {
    paymentIntentId: facts.paymentIntentId,
    chargeId: facts.chargeId,
    receiptUrl: facts.receiptUrl
  })
  return { kind: "ordinary" }
}
