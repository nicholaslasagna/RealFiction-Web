// Resolves the project's "@/..." tsconfig path alias for `node --test`, so route
// handlers can be imported and exercised directly instead of being re-implemented
// in test doubles. Test-only; not part of the app or the Cloudflare bundle.
import { existsSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export async function resolve(specifier, context, next) {
  // Extensionless relative imports: normal for TypeScript source, unresolvable
  // for Node ESM. Map them onto the real .ts file so a source module can be
  // imported by a test without polluting it with test-only extensions.
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !path.extname(specifier)) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : repoRoot
    const base = path.resolve(path.dirname(parentPath), specifier)
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true }
      }
    }
    return next(specifier, context)
  }

  if (!specifier.startsWith("@/")) {
    return next(specifier, context)
  }

  const base = path.join(repoRoot, specifier.slice(2))
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]

  for (const candidate of candidates) {
    if (existsSync(candidate) && !existsSync(path.join(candidate, "."))) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true }
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true }
    }
  }

  return next(specifier, context)
}
