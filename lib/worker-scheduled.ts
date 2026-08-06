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

export type ScheduledController = { scheduledTime: number; cron: string }
export type ScheduledCtx = { waitUntil(promise: Promise<unknown>): void }
export type ScheduledEnv = ProcessorEnv

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
  deps: { processEmailQueue?: typeof processEmailQueue } = {}
): Promise<unknown>[] {
  const drainEmails = deps.processEmailQueue ?? processEmailQueue

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

  const registered = [emails]
  for (const promise of registered) {
    ctx.waitUntil(promise)
  }
  return registered
}
