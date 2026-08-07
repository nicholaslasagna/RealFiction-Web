// Cloudflare Worker entry.
//
// Wraps the OpenNext-generated worker so the app keeps its normal `fetch`
// handler and gains a `scheduled` handler. The Cron Trigger lives in
// wrangler.toml — there is exactly one, shared by both scheduled jobs.
//
// Why a scheduled handler at all:
//   * the Stripe webhook must return 2xx without ever awaiting a Resend request,
//     so it enqueues a durable delivery row and this drains it out-of-band; and
//   * a webhook can be lost outright, so paid orders that never got one are
//     reconciled against Stripe and fulfilled here.
//
// The body lives in lib/worker-scheduled.ts so it can be executed by tests; this
// file must stay thin enough to be obviously correct by reading it.
import { runScheduledJobs, type ScheduledCtx, type ScheduledEnv } from "../lib/worker-scheduled"
import { fulfilVerifiedPayment } from "../lib/store/fulfil-verified-payment"

// Re-export the Durable Object classes OpenNext generates, or the deployment
// loses its cache/queue bindings.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "../.open-next/worker.js"

import openNextWorker from "../.open-next/worker.js"

type ScheduledController = { scheduledTime: number; cron: string }

export default {
  fetch: openNextWorker.fetch,

  async scheduled(controller: ScheduledController, env: ScheduledEnv, ctx: ScheduledCtx) {
    // Both jobs are registered with ctx.waitUntil inside, so neither is
    // abandoned when this handler returns.
    runScheduledJobs(controller, env, ctx, {
      // The SAME dispatch the Stripe webhook calls. Injected rather than
      // imported by lib/worker-scheduled.ts so that module stays directly
      // executable by tests.
      //
      // The dispatch and everything it reaches must stay free of the
      // `server-only` marker: wrangler bundles this entry without the
      // `react-server` export condition, so the marker resolves to a module
      // that throws on import and the deploy fails validation (Cloudflare
      // 10021) before any request or cron runs. lib/server-boundary.test.ts
      // fails the suite if that marker ever comes back.
      fulfil: (orderId, facts) =>
        fulfilVerifiedPayment(orderId, { ...facts }, env as Record<string, string | undefined>)
    })
  }
}
