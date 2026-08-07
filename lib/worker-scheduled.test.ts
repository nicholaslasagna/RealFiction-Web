// The Cloudflare scheduled handler, EXECUTED.
//
// Reading the source and seeing `ctx.waitUntil(...)` proves the call is written.
// It does not prove the work is registered, that a failure is contained, or that
// the runtime env actually reaches it. These tests run the thing.
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

test("the drain is registered with ctx.waitUntil, not merely started", async () => {
  const { ctx, registered } = fakeCtx()
  let emails = 0

  const returned = runScheduledJobs(CONTROLLER, ENV, ctx, {
    processEmailQueue: async () => {
      emails++
      return { claimed: 0, sent: 0, failed: 0, retried: 0 } as never
    }
  })

  // Cloudflare kills the event when the handler returns unless the work is
  // registered.
  assert.equal(
    registered.length,
    4,
    "email, payment reconciliation, refund reconciliation, and abuse retention are registered separately"
  )
  assert.equal(returned.length, 4)

  await Promise.all(registered)
  assert.equal(emails, 1)
})

test("a failing drain is contained, not thrown into the scheduled event", async () => {
  const { ctx, registered } = fakeCtx()
  runScheduledJobs(CONTROLLER, ENV, ctx, {
    processEmailQueue: async () => {
      throw new Error("resend exploded")
    }
  })
  const results = await Promise.all(registered)
  assert.equal(results[0], null, "the email job absorbs its own failure")
})

test("a failure produces no unhandled rejection", async () => {
  const seen: unknown[] = []
  const onUnhandled = (reason: unknown) => seen.push(reason)
  process.on("unhandledRejection", onUnhandled)

  try {
    const { ctx, registered } = fakeCtx()
    runScheduledJobs(CONTROLLER, ENV, ctx, {
      processEmailQueue: async () => {
        throw new Error("a")
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

test("the explicit Worker env reaches the job — process.env is empty in scheduled()", async () => {
  const { ctx, registered } = fakeCtx()
  let emailEnv: unknown = null

  runScheduledJobs(CONTROLLER, ENV, ctx, {
    processEmailQueue: async (env) => {
      emailEnv = env
      return { claimed: 0, sent: 0, failed: 0, retried: 0 } as never
    }
  })

  await Promise.all(registered)
  assert.equal(emailEnv, ENV)
})

// -- The deployed entry ------------------------------------------------------
// worker/index.ts cannot be imported here: it imports .open-next/worker.js,
// which is build output. These assertions are about the file's SHAPE, and are
// labelled as such — the behaviour above is what was actually executed.

const repoRoot = path.resolve(import.meta.dirname, "..")
const workerSource = readFileSync(path.join(repoRoot, "worker", "index.ts"), "utf8")
const wrangler = readFileSync(path.join(repoRoot, "wrangler.toml"), "utf8")

test("the deployed entry delegates to the function these tests executed", () => {
  assert.match(workerSource, /runScheduledJobs\(controller, env, ctx/)
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
