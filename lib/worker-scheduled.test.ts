// The Cloudflare scheduled handler, EXECUTED.
//
// Reading the source and seeing `ctx.waitUntil(...)` proves the call is written.
// It does not prove both jobs are registered, that one job's failure does not
// take the other down, or that the runtime env actually reaches them. These
// tests run the thing.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { register } from "node:module"
import path from "node:path"
import test from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

const { runScheduledJobs } = await import("./worker-scheduled.ts")

const CONTROLLER = { scheduledTime: 1_700_000_000_000, cron: "*/5 * * * *" }

function fakeCtx() {
  const registered: Promise<unknown>[] = []
  return {
    ctx: {
      waitUntil(promise: Promise<unknown>) {
        registered.push(promise)
      }
    },
    registered
  }
}

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-value",
  STRIPE_SECRET_KEY: "stripe-secret-value",
  STRIPE_ENVIRONMENT: "test",
  RESEND_API_KEY: "resend-value"
} as never

test("BOTH jobs are registered with ctx.waitUntil, not merely started", async () => {
  const { ctx, registered } = fakeCtx()
  let emails = 0
  let upgrades = 0

  const returned = runScheduledJobs(CONTROLLER, ENV, ctx, {
    processEmailQueue: async () => {
      emails++
      return { claimed: 0, sent: 0, failed: 0, retried: 0 } as never
    },
    reconcileUpgradeReservations: async () => {
      upgrades++
      return { claimed: 0, fulfilled: 0, held: 0, released: 0, mismatched: 0, unavailable: 0, escalated: 0 }
    }
  })

  // Cloudflare kills the event when the handler returns unless the work is
  // registered. Two jobs, two registrations.
  assert.equal(registered.length, 2)
  assert.equal(returned.length, 2)

  await Promise.all(registered)
  assert.equal(emails, 1)
  assert.equal(upgrades, 1)
})

test("an EMAIL failure does not cancel reconciliation", async () => {
  const { ctx, registered } = fakeCtx()
  let reconciled = false

  runScheduledJobs(CONTROLLER, ENV, ctx, {
    processEmailQueue: async () => {
      throw new Error("resend exploded")
    },
    reconcileUpgradeReservations: async () => {
      reconciled = true
      return { claimed: 3, fulfilled: 1, held: 2, released: 0, mismatched: 0, unavailable: 0, escalated: 0 }
    }
  })

  const results = await Promise.all(registered)
  assert.equal(reconciled, true, "reconciliation must still run")
  assert.equal(results[0], null, "the email job absorbs its own failure")
  assert.deepEqual((results[1] as { fulfilled: number }).fulfilled, 1)
})

test("a RECONCILIATION failure does not cancel the email drain", async () => {
  const { ctx, registered } = fakeCtx()
  let drained = false

  runScheduledJobs(CONTROLLER, ENV, ctx, {
    processEmailQueue: async () => {
      drained = true
      return { claimed: 5, sent: 5, failed: 0, retried: 0 } as never
    },
    reconcileUpgradeReservations: async () => {
      throw new Error("stripe exploded")
    }
  })

  const results = await Promise.all(registered)
  assert.equal(drained, true, "the email queue must still drain")
  assert.equal(results[1], null, "the reconciliation job absorbs its own failure")
  assert.equal((results[0] as { claimed: number }).claimed, 5)
})

test("neither failure produces an unhandled rejection", async () => {
  const seen: unknown[] = []
  const onUnhandled = (reason: unknown) => seen.push(reason)
  process.on("unhandledRejection", onUnhandled)

  try {
    const { ctx, registered } = fakeCtx()
    runScheduledJobs(CONTROLLER, ENV, ctx, {
      processEmailQueue: async () => {
        throw new Error("a")
      },
      reconcileUpgradeReservations: async () => {
        throw new Error("b")
      }
    })
    await Promise.all(registered)
    // Rejections surface on the next macrotask; give them one.
    await new Promise((resolve) => setTimeout(resolve, 10))
  } finally {
    process.off("unhandledRejection", onUnhandled)
  }

  assert.deepEqual(seen, [], "a scheduled event with an unhandled rejection is a Worker error")
})

test("the explicit Worker env reaches BOTH jobs — process.env is empty in scheduled()", async () => {
  const { ctx, registered } = fakeCtx()
  let emailEnv: unknown = null
  let reconcileEnv: unknown = null

  runScheduledJobs(CONTROLLER, ENV, ctx, {
    processEmailQueue: async (env) => {
      emailEnv = env
      return { claimed: 0, sent: 0, failed: 0, retried: 0 } as never
    },
    reconcileUpgradeReservations: async (env) => {
      reconcileEnv = env
      return { claimed: 0, fulfilled: 0, held: 0, released: 0, mismatched: 0, unavailable: 0, escalated: 0 }
    }
  })

  await Promise.all(registered)
  assert.equal(emailEnv, ENV)
  assert.equal(reconcileEnv, ENV)
})

test("both jobs are given the same scheduled-tick worker id", async () => {
  const { ctx, registered } = fakeCtx()
  const ids: string[] = []

  runScheduledJobs(CONTROLLER, ENV, ctx, {
    processEmailQueue: async (_env, options) => {
      ids.push(String((options as { workerId?: string }).workerId))
      return { claimed: 0, sent: 0, failed: 0, retried: 0 } as never
    },
    reconcileUpgradeReservations: async (_env, options) => {
      ids.push(String((options as { workerId?: string })?.workerId))
      return { claimed: 0, fulfilled: 0, held: 0, released: 0, mismatched: 0, unavailable: 0, escalated: 0 }
    }
  })

  await Promise.all(registered)
  assert.deepEqual(ids, [`cron-${CONTROLLER.scheduledTime}`, `cron-${CONTROLLER.scheduledTime}`])
})

// -- The deployed entry ------------------------------------------------------
// worker/index.ts cannot be imported here: it imports .open-next/worker.js,
// which is build output. These assertions are about the file's SHAPE, and are
// labelled as such — the behaviour above is what was actually executed.

const repoRoot = path.resolve(import.meta.dirname, "..")
const workerSource = readFileSync(path.join(repoRoot, "worker", "index.ts"), "utf8")
const wrangler = readFileSync(path.join(repoRoot, "wrangler.toml"), "utf8")

test("the deployed entry delegates to the function these tests executed", () => {
  assert.match(workerSource, /runScheduledJobs\(controller, env, ctx\)/)
  assert.match(workerSource, /import openNextWorker from "\.\.\/\.open-next\/worker\.js"/)
  assert.match(workerSource, /fetch:\s*openNextWorker\.fetch/)
})

test("there is still exactly ONE cron trigger", () => {
  assert.match(wrangler, /^main\s*=\s*"worker\/index\.ts"$/m)
  assert.equal((wrangler.match(/crons\s*=/g) ?? []).length, 1)
  assert.match(wrangler, /crons\s*=\s*\["\*\/5 \* \* \* \*"\]/)
})

test("the scheduled handler never reads process.env", () => {
  const scheduled = readFileSync(path.join(repoRoot, "lib", "worker-scheduled.ts"), "utf8")
  const code = scheduled.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
  assert.ok(!/process\.env/.test(code), "process.env is not populated in scheduled()")
  assert.ok(!/process\.env/.test(workerSource.replace(/\/\/.*$/gm, "")))
})
