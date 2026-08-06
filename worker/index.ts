// Cloudflare Worker entry.
//
// Wraps the OpenNext-generated worker so the app keeps its normal `fetch`
// handler and gains a `scheduled` handler for the email queue. The Cron Trigger
// lives in wrangler.toml.
//
// Why a scheduled handler at all: the Stripe webhook must return 2xx without
// ever awaiting a Resend request. It enqueues a durable delivery row; this
// drains the queue out-of-band.
import { processEmailQueue, type ProcessorEnv } from "../lib/email/processor"

// Re-export the Durable Object classes OpenNext generates, or the deployment
// loses its cache/queue bindings.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "../.open-next/worker.js"

import openNextWorker from "../.open-next/worker.js"

type ScheduledController = { scheduledTime: number; cron: string }
type Ctx = { waitUntil(promise: Promise<unknown>): void }

export default {
  fetch: openNextWorker.fetch,

  async scheduled(controller: ScheduledController, env: ProcessorEnv, ctx: Ctx) {
    // waitUntil so the drain finishes even after this handler returns; the
    // processor never throws, so a mail problem cannot fail the cron run.
    ctx.waitUntil(
      processEmailQueue(env, { workerId: `cron-${controller.scheduledTime}` }).then((result) => {
        if (result.claimed > 0) {
          console.info("email_queue_drained", result)
        }
      })
    )
  }
}
