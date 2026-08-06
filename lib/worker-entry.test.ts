// Custom OpenNext worker entry.
//
// wrangler.toml points `main` at worker/index.ts, so this file is the deployed
// entry point: it must forward fetch to the generated OpenNext handler, expose
// scheduled(), re-export every Durable Object OpenNext generates, and track its
// processing with ctx.waitUntil.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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
  assert.match(workerSource, /processEmailQueue\(env/)
})

test("ctx.waitUntil tracks the processing so the event is not cut short", () => {
  assert.match(workerSource, /ctx\.waitUntil\(/)
})

test("every Durable Object OpenNext generates is re-exported", () => {
  // Missing one silently breaks the deployment's cache/queue bindings.
  const generated = readFileSync(path.join(repoRoot, ".open-next", "worker.js"), "utf8")
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

test("the build output contains the custom worker entry's dependencies", () => {
  // The generated worker must exist for the custom entry to import it.
  const generated = path.join(repoRoot, ".open-next", "worker.js")
  assert.ok(readFileSync(generated, "utf8").length > 0)
})
