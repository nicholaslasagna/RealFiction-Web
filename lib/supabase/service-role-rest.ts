import "server-only"

export type SupabaseRestError = {
  code?: string
  message: string
  status: number
}

export class ServiceRoleRestConfigError extends Error {
  // A plain field, not a constructor parameter property: Node's type-stripping
  // (used by `node --test`) cannot parse parameter properties, which made this
  // whole module — and therefore every route importing it — unloadable from any
  // test. The same fix was already applied to lib/supabase/service-role.ts.
  readonly missing: string[]

  constructor(missing: string[]) {
    super(`Supabase REST service-role configuration is missing: ${missing.join(", ")}`)
    this.name = "ServiceRoleRestConfigError"
    this.missing = missing
  }
}

function serviceRoleUrl() {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
}

function serviceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
}

function restConfig() {
  const url = serviceRoleUrl().replace(/\/+$/, "")
  const key = serviceRoleKey()
  const missing: string[] = []

  if (!url) {
    missing.push("SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL")
  }
  if (!key) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY")
  }
  if (missing.length > 0) {
    throw new ServiceRoleRestConfigError(missing)
  }

  return { url, key }
}

async function parseRestError(response: Response): Promise<SupabaseRestError> {
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown; hint?: unknown; details?: unknown }
    const message =
      typeof body.message === "string"
        ? body.message
        : typeof body.details === "string"
          ? body.details
          : `Supabase REST returned HTTP ${response.status}`

    return {
      code: typeof body.code === "string" ? body.code : undefined,
      message,
      status: response.status
    }
  } catch {
    return {
      message: `Supabase REST returned HTTP ${response.status}`,
      status: response.status
    }
  }
}

async function serviceRoleFetch(path: string, init: RequestInit) {
  const { url, key } = restConfig()
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {})
    }
  })

  if (!response.ok) {
    return { ok: false as const, error: await parseRestError(response) }
  }

  return { ok: true as const, response }
}

export async function insertPluginNonce(row: {
  nonce_hash: string
  server_id: string
  route: string
  expires_at: string
}) {
  const result = await serviceRoleFetch("/rest/v1/plugin_request_nonces", {
    method: "POST",
    headers: {
      Prefer: "return=minimal"
    },
    body: JSON.stringify(row)
  })

  if (!result.ok) {
    return { error: result.error }
  }

  return { error: null }
}

export async function callServiceRoleRpc<T>(functionName: string, args: Record<string, unknown>) {
  const result = await serviceRoleFetch(`/rest/v1/rpc/${functionName}`, {
    method: "POST",
    body: JSON.stringify(args)
  })

  if (!result.ok) {
    return { data: null, error: result.error }
  }

  if (result.response.status === 204) {
    return { data: null as T | null, error: null }
  }

  return { data: (await result.response.json()) as T, error: null }
}
