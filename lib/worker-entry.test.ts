// Custom OpenNext worker entry.
//
// wrangler.toml points `main` at worker/index.ts, so this file is the deployed
// entry point: it must forward fetch to the generated OpenNext handler, expose
// scheduled(), re-export every Durable Object OpenNext generates, and track its
// processing with ctx.waitUntil.
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

const repoRoot = path.resolve(import.meta.dirname, "..")
const workerSource = readFileSync(path.join(repoRoot, "worker", "index.ts"), "utf8")
const wrangler = readFileSync(path.join(repoRoot, "wrangler.toml"), "utf8")

test("wrangler points at the custom entry and schedules the drain", () => {
  assert.match(wrangler, /^main\s*=\s*"worker\/index\.ts"$/m)
  assert.match(wrangler, /\[triggers\]/)
  assert.match(wrangler, /crons\s*=\s*\["\*\/5 \* \* \* \*"\]/)
})

test("the entry forwards fetch to the generated OpenNext handler", () => {
  assert.match(workerSource, /import openNextWorker from "\.\.\/\.open-next\/worker\.js"/)
  assert.match(workerSource, /fetch:\s*openNextWorker\.fetch/)
})

test("the entry exposes scheduled() and passes runtime env explicitly", () => {
  assert.match(workerSource, /async scheduled\(/)
  // process.env is not populated in a scheduled invocation, so env must flow in.
  assert.match(workerSource, /runScheduledJobs\(controller, env, ctx\)/)
})

// The waitUntil registration and failure isolation are EXECUTED in
// lib/worker-scheduled.test.ts. This file only guards the deployed entry's shape.

// The generated worker is BUILD OUTPUT, absent in a fresh checkout. These two
// assertions are only meaningful once `npm run build:cloudflare` has run, so
// they skip explicitly rather than failing a clean `npm ci && npm test`.
const generatedWorker = path.join(repoRoot, ".open-next", "worker.js")
const built = existsSync(generatedWorker)
const skipUnbuilt = built ? false : "requires `npm run build:cloudflare` output"

test("every Durable Object OpenNext generates is re-exported", { skip: skipUnbuilt }, () => {
  // Missing one silently breaks the deployment's cache/queue bindings.
  const generated = readFileSync(generatedWorker, "utf8")
  const exported = [...generated.matchAll(/export\s*\{\s*(\w+)\s*\}/g)].map((match) => match[1])

  assert.ok(exported.length > 0, "expected the generated worker to export Durable Objects")
  for (const name of exported) {
    assert.match(
      workerSource,
      new RegExp(`\\b${name}\\b`),
      `worker/index.ts must re-export ${name}`
    )
  }
})

test("the build output contains the custom worker entry's dependencies", { skip: skipUnbuilt }, () => {
  // The generated worker must exist for the custom entry to import it.
  assert.ok(readFileSync(generatedWorker, "utf8").length > 0)
})
