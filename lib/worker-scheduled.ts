// What the Cloudflare scheduled handler actually does, extracted so it can be
// EXECUTED in a test rather than asserted about as text.
//
// Cloudflare terminates a Worker's event as soon as the handler's returned
// promise settles. Any promise not awaited and not registered with
// `ctx.waitUntil` is abandoned at that moment — mid-fetch, mid-transaction,
// mid-anything. The drain registers explicitly.
//
// The drain swallows its own errors and carries a terminal `.catch`, so a mail
// problem is reported and contained rather than surfacing as an unhandled
// rejection inside a scheduled event.

import { processEmailQueue, type ProcessorEnv } from "./email/processor"
import { reconcilePendingStripeOrders, type ReconcileEnv } from "./store/reconcile-pending"
import { reconcileGiftCardRefunds, type RefundReconcileEnv } from "./gift-card/reconcile-refunds"

export type ScheduledController = { scheduledTime: number; cron: string }
export type ScheduledCtx = { waitUntil(promise: Promise<unknown>): void }
export type ScheduledEnv = ProcessorEnv & ReconcileEnv & RefundReconcileEnv

/**
 * Registers the scheduled work for the Worker's lifetime.
 *
 * Returns the registered promises so a test can await exactly what Cloudflare
 * would keep alive. Nothing here throws: the processor already swallows its own
 * errors, and the terminal `.catch` is the belt to that braces — an unhandled
 * rejection inside a scheduled event is reported as a Worker error.
 */
export function runScheduledJobs(
  controller: ScheduledController,
  env: ScheduledEnv,
  ctx: ScheduledCtx,
  deps: {
    processEmailQueue?: typeof processEmailQueue
    reconcilePendingStripeOrders?: typeof reconcilePendingStripeOrders
    reconcileGiftCardRefunds?: typeof reconcileGiftCardRefunds
    /**
     * The shared fulfilment dispatch. Injected because it is `server-only` and
     * this module is executed directly by tests; the Worker entry supplies the
     * real one.
     */
    fulfil?: (
      orderId: string,
      facts: { paymentIntentId: string | null; chargeId: string | null; receiptUrl: string | null }
    ) => Promise<unknown>
  } = {}
): Promise<unknown>[] {
  const drainEmails = deps.processEmailQueue ?? processEmailQueue
  const reconcile = deps.reconcilePendingStripeOrders ?? reconcilePendingStripeOrders
  const reconcileRefunds = deps.reconcileGiftCardRefunds ?? reconcileGiftCardRefunds

  // `env` is passed explicitly: `process.env` is not populated in a scheduled
  // invocation, so anything reading it there sees undefined.
  const emails = drainEmails(env, { workerId: `cron-${controller.scheduledTime}` })
    .then((result) => {
      if (result.claimed > 0) {
        console.info("email_queue_drained", result)
      }
      return result
    })
    .catch((error) => {
      console.error("email_queue_failed", error instanceof Error ? error.message : "unknown")
      return null
    })

  // Shares the existing Cron rather than adding a second one. A SEPARATE
  // promise, deliberately: a reconciliation failure must not stop the email
  // queue draining, and an email failure must not stop a paid-but-unfulfilled
  // order being recovered. Promise.all would couple them.
  const reconciliation = deps.fulfil
    ? reconcile(env, { workerId: `cron-${controller.scheduledTime}`, fulfil: deps.fulfil })
        .then((result) => {
          if (result.selected > 0) {
            // Counts and categories only — no session ids, customers, or secrets.
            console.info("reconciliation_summary", result)
          }
          return result
        })
        .catch((error) => {
          console.error(
            "reconciliation_failed",
            error instanceof Error ? error.message : "unknown"
          )
          return null
        })
    : Promise.resolve(null)

  // A THIRD isolated job on the same Cron. Separate promise, own terminal
  // catch: a refund problem must not stop payments being recovered or email
  // being sent, and neither of those may stop a stranded refund finalising.
  const refunds = reconcileRefunds(env, { workerId: `cron-${controller.scheduledTime}` })
    .then((result) => {
      if (result.selected > 0) {
        console.info("gift_card_refund_reconciliation_summary", result)
      }
      return result
    })
    .catch((error) => {
      console.error(
        "gift_card_refund_reconciliation_failed",
        error instanceof Error ? error.message : "unknown"
      )
      return null
    })

  const registered = [emails, reconciliation, refunds]
  for (const promise of registered) {
    ctx.waitUntil(promise)
  }
  return registered
}
