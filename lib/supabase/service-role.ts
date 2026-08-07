// NO `server-only` MARKER, DELIBERATELY.
//
// This module is reachable from the Cloudflare Worker entry (worker/index.ts)
// as well as from Next server code. Wrangler bundles that entry WITHOUT the
// `react-server` export condition, so `server-only` resolves to its throwing
// `index.js` rather than the empty stub Next resolves it to — and the Worker
// then fails deploy validation with Cloudflare error 10021 before it ever runs.
//
// The boundary this marker used to provide is enforced instead by
// lib/server-boundary.test.ts, which fails if any `"use client"` module can
// reach a privileged module. That check covers the Worker graph too, which the
// marker never could.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let serviceClient: SupabaseClient | null = null

/** Thrown when the service-role env vars are not present at runtime. */
export class ServiceRoleConfigError extends Error {
  // A plain field, not a constructor parameter property: Node's type-stripping
  // (used by `node --test`) cannot parse parameter properties, which made this
  // whole module unloadable from any test.
  readonly missing: string[]

  constructor(missing: string[]) {
    super(`Supabase service-role configuration is missing: ${missing.join(", ")}`)
    this.name = "ServiceRoleConfigError"
    this.missing = missing
  }
}

// SUPABASE_URL is a server-only runtime fallback. NEXT_PUBLIC_SUPABASE_URL is
// inlined at build time, so it can be present even when no runtime var is set;
// the service-role KEY is never public and must be a runtime secret.
function serviceRoleUrl() {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
}

function serviceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
}

/** Names of any service-role env vars missing at runtime (for safe logging). */
export function missingServiceRoleConfig(): string[] {
  const missing: string[] = []
  if (!serviceRoleUrl()) {
    missing.push("SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL")
  }
  if (!serviceRoleKey()) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY")
  }
  return missing
}

export function hasServiceRoleConfig(): boolean {
  return missingServiceRoleConfig().length === 0
}

export function getSupabaseServiceRoleClient() {
  if (!serviceClient) {
    const missing = missingServiceRoleConfig()
    if (missing.length > 0) {
      throw new ServiceRoleConfigError(missing)
    }

    serviceClient = createClient(serviceRoleUrl(), serviceRoleKey(), {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  }

  return serviceClient
}
