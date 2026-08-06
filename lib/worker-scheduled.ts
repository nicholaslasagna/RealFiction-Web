// What the Cloudflare scheduled handler actually does, extracted so it can be
// EXECUTED in a test rather than asserted about as text.
//
// Cloudflare terminates a Worker's event as soon as the handler's returned
// promise settles. Any promise not awaited and not registered with
// `ctx.waitUntil` is abandoned at that moment — mid-fetch, mid-transaction,
// mid-anything. Both jobs here register explicitly.
//
// The two jobs are also FAILURE-ISOLATED from each other. They are registered as
// separate `waitUntil` promises, each with its own terminal `.catch`, so:
//   * a reconciliation failure cannot stop the email queue draining, and
//   * an email failure cannot stop a paid-but-unfulfilled order being recovered.
// A single combined `Promise.all` would couple them: one rejection would reject
// the combined promise and leave the other's outcome unreported.

import { processEmailQueue, type ProcessorEnv } from "./email/processor"
import { reconcileUpgradeReservations, type ReconcileEnv } from "./store/reconcile-upgrades"

export type ScheduledController = { scheduledTime: number; cron: string }
export type ScheduledCtx = { waitUntil(promise: Promise<unknown>): void }
export type ScheduledEnv = ProcessorEnv & ReconcileEnv

/**
 * Registers both scheduled jobs for the Worker's lifetime.
 *
 * Returns the registered promises so a test can await exactly what Cloudflare
 * would keep alive. Nothing here throws: both jobs already swallow their own
 * errors, and the terminal `.catch` is the belt to that braces — an unhandled
 * rejection inside a scheduled event is reported as a Worker error.
 */
export function runScheduledJobs(
  controller: ScheduledController,
  env: ScheduledEnv,
  ctx: ScheduledCtx,
  deps: {
    processEmailQueue?: typeof processEmailQueue
    reconcileUpgradeReservations?: typeof reconcileUpgradeReservations
  } = {}
): Promise<unknown>[] {
  const drainEmails = deps.processEmailQueue ?? processEmailQueue
  const reconcile = deps.reconcileUpgradeReservations ?? reconcileUpgradeReservations

  // `env` is passed explicitly to both: `process.env` is not populated in a
  // scheduled invocation, so anything reading it there sees undefined.
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

  // Shares the existing schedule rather than adding a second Cron Trigger.
  const upgrades = reconcile(env, { workerId: `cron-${controller.scheduledTime}` })
    .then((result) => {
      if (result.claimed > 0) {
        // Decisions and counts only — no session ids, no customers, no secrets.
        console.info("upgrade_reservations_reconciled", result)
      }
      return result
    })
    .catch((error) => {
      console.error(
        "upgrade_reconciliation_failed",
        error instanceof Error ? error.message : "unknown"
      )
      return null
    })

  const registered = [emails, upgrades]
  for (const promise of registered) {
    ctx.waitUntil(promise)
  }
  return registered
}
