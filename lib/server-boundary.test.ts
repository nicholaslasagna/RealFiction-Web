// The server/client boundary, enforced structurally.
//
// WHY THIS FILE EXISTS
// ====================
// Six privileged modules used to carry `import "server-only"`. That marker is
// wrong for them: they are reachable from the Cloudflare Worker entry
// (worker/index.ts) as well as from Next server code, and wrangler bundles that
// entry WITHOUT the `react-server` export condition. `server-only` therefore
// resolved to its throwing `index.js` instead of the empty stub Next resolves
// it to, and the Worker failed Cloudflare deploy validation (error 10021)
// before running a single line.
//
// Removing a guard without replacing it would be a downgrade, so this is the
// replacement — and it is strictly stronger than what it replaces:
//
//   `server-only`  fails the NEXT build when a Client Component imports a
//                  marked module. Says nothing about the Worker.
//   this file      fails the TEST SUITE when a `"use client"` module can reach
//                  a privileged module, AND fails when a privileged module
//                  re-acquires a marker that breaks the Worker deploy.
//
// It is a graph walk over real imports, not a grep, so an indirect chain
// through three intermediate modules is caught exactly like a direct one.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

const repoRoot = path.resolve(import.meta.dirname, "..")

/**
 * Modules that hold, or can reach, privileged capability: the service-role
 * client, fulfilment, and the abuse counters.
 *
 * These are exactly the modules the Worker shares with Next server code, which
 * is why none of them may carry `server-only`.
 */
const PRIVILEGED = [
  "lib/supabase/service-role.ts",
  "lib/supabase/service-role-rest.ts",
  "lib/supabase/server.ts",
  "lib/store-server.ts",
  "lib/store/fulfil-verified-payment.ts",
  "lib/gift-card/fulfillment.ts",
  "lib/abuse/guard.ts",
  "lib/abuse/purchases.ts"
]

/** The modules the Cloudflare Worker statically pulls in. */
const WORKER_ENTRY = "worker/index.ts"

const IMPORT =
  /^\s*(?:import|export)\s.*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/
const TYPE_ONLY = /^\s*(?:import|export)\s+type\s/

function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith("@/")) {
    base = spec.slice(2)
  } else if (spec.startsWith(".")) {
    base = path.normalize(path.join(path.dirname(fromFile), spec))
  } else {
    // A bare package specifier. Only `server-only` itself matters here.
    return spec === "server-only" ? "server-only" : null
  }
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base]) {
    if (fs.existsSync(path.join(repoRoot, candidate)) && fs.statSync(path.join(repoRoot, candidate)).isFile()) {
      return candidate
    }
  }
  return null
}

/** Every module reachable from `entry`, with the chain that got there. */
function reachable(entry: string): Map<string, string[]> {
  const found = new Map<string, string[]>()

  const walk = (file: string, chain: string[]) => {
    if (found.has(file) || file === "server-only") {
      if (file === "server-only") {
        found.set(file, chain)
      }
      return
    }
    found.set(file, chain)

    const full = path.join(repoRoot, file)
    if (!fs.existsSync(full)) {
      return
    }

    for (const line of fs.readFileSync(full, "utf8").split("\n")) {
      // A type-only import is erased at compile time and cannot poison a bundle.
      if (TYPE_ONLY.test(line)) {
        continue
      }
      const match = IMPORT.exec(line)
      if (!match) {
        continue
      }
      const next = resolveSpec(match[1] ?? match[2], file)
      if (next) {
        walk(next, [...chain, next])
      }
    }
  }

  walk(entry, [entry])
  return found
}

function clientModules(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(rel)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
        continue
      }
      if (fs.readFileSync(path.join(repoRoot, rel), "utf8").trimStart().startsWith('"use client"')) {
        out.push(rel)
      }
    }
  }
  walk("app")
  walk("components")
  return out
}

// ===========================================================================
// THE WORKER MUST NEVER SEE `server-only`
// ===========================================================================

test("the Cloudflare Worker graph contains NO server-only import", () => {
  // This is the regression test for the deploy failure. `server-only`'s package
  // exports resolve to a module whose only job is to throw, and wrangler does
  // not apply the `react-server` condition that would swap it for the stub. One
  // reachable import anywhere in this graph fails the deploy, not a request.
  const graph = reachable(WORKER_ENTRY)
  const chain = graph.get("server-only")

  assert.equal(
    chain,
    undefined,
    chain
      ? `server-only reaches the Worker via:\n    ${chain.join("\n -> ")}`
      : ""
  )
})

test("every privileged module the Worker shares stays free of the marker", () => {
  const graph = reachable(WORKER_ENTRY)

  for (const module of PRIVILEGED) {
    if (!graph.has(module)) {
      continue
    }
    const source = fs.readFileSync(path.join(repoRoot, module), "utf8")
    assert.ok(
      !/^\s*import\s+["']server-only["']/m.test(source),
      `${module} is in the Worker graph and must not import server-only`
    )
  }
})

// ===========================================================================
// NO CLIENT COMPONENT MAY REACH A PRIVILEGED MODULE
//
// This is the guarantee `server-only` used to give, restated so it holds for a
// module the Worker also uses.
// ===========================================================================

test("NO Client Component can reach a privileged module", () => {
  const privileged = new Set(PRIVILEGED)
  const violations: string[] = []

  for (const entry of clientModules()) {
    const graph = reachable(entry)
    for (const module of graph.keys()) {
      if (privileged.has(module)) {
        violations.push(`${entry}\n -> ${(graph.get(module) ?? []).join("\n -> ")}`)
      }
    }
  }

  assert.deepEqual(violations, [], `a client component reaches privileged code:\n${violations.join("\n\n")}`)
})

test("the scan actually found the client components it claims to check", () => {
  // A guard against the guard: a broken walker that finds nothing would make
  // the test above pass vacuously forever.
  const found = clientModules()
  assert.ok(found.length >= 20, `expected the app's client components, found ${found.length}`)
  assert.ok(found.some((f) => f.startsWith("components/")), "no client components under components/")
})

test("the reachability walker actually resolves the Worker graph", () => {
  // Same reasoning: prove the walker traverses rather than returning a stub.
  const graph = reachable(WORKER_ENTRY)
  assert.ok(graph.has("lib/worker-scheduled.ts"), "did not follow worker/index.ts -> worker-scheduled")
  assert.ok(graph.has("lib/store/fulfil-verified-payment.ts"), "did not follow the fulfilment edge")
  assert.ok(graph.size > 15, `walked only ${graph.size} modules`)
})
