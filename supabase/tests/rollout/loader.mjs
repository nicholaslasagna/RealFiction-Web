// Module resolution for the rollout harness.
//
// The harness loads application code from TWO checkouts at once — the current
// tree and a worktree at the pre-store commit. Three things have to be handled
// for that to be honest:
//
//   1. `@/...` must resolve against the IMPORTING file's own repository root.
//      Resolving it against a single root would quietly mix new modules into the
//      old application and prove nothing.
//   2. `server-only` is a build-time marker that throws outside a server bundle.
//   3. The Supabase client must reach the disposable database chosen for the
//      current combination, not a network.
import { existsSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const STUBS = {
  "server-only": path.join(here, "stub-server-only.mjs"),
  "@/lib/supabase/service-role": path.join(here, "stub-service-role.mjs")
}

/** The repository root that OWNS a given file: nearest ancestor package.json. */
function rootFor(filePath) {
  let dir = path.dirname(filePath)
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, "package.json"))) return dir
    dir = path.dirname(dir)
  }
  return dir
}

function firstExisting(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && path.extname(candidate)) return candidate
  }
  return null
}

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) {
    return { url: pathToFileURL(STUBS[specifier]).href, shortCircuit: true }
  }

  const parent = context.parentURL?.startsWith("file:") ? fileURLToPath(context.parentURL) : null

  if (specifier.startsWith("@/") && parent) {
    const resolved = firstExisting(path.join(rootFor(parent), specifier.slice(2)))
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true }
  }

  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !path.extname(specifier) && parent) {
    const resolved = firstExisting(path.resolve(path.dirname(parent), specifier))
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true }
  }

  return next(specifier, context)
}
