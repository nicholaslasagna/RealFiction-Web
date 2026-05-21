import "server-only"

import {
  constantTimeEqual,
  describeError,
  getRequestSecret,
  isSharedSecretAuthAllowed,
  requireConfiguredSecret,
  safeJsonError,
  sha256Hex,
  verifySharedSecret
} from "@/lib/security"
import { insertPluginNonce } from "@/lib/supabase/service-role-rest"

const HMAC_WINDOW_MS = 5 * 60 * 1000

export type PluginAuthResult =
  | { ok: true; mode: "hmac" | "shared-secret"; serverId: string }
  | { ok: false; response: Response }

async function hmacSha256Hex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))

  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function getPluginSecret() {
  try {
    return requireConfiguredSecret("REALCORE_PLUGIN_SECRET")
  } catch {
    return null
  }
}

export async function requirePluginAuth(request: Request, rawBody: string, routeName: string): Promise<PluginAuthResult> {
  const expectedSecret = getPluginSecret()

  if (!expectedSecret) {
    return { ok: false, response: safeJsonError("Plugin authorization is not configured.", 503) }
  }

  const serverId = request.headers.get("x-realfiction-plugin-server-id")
  const timestamp = request.headers.get("x-realfiction-plugin-timestamp")
  const nonce = request.headers.get("x-realfiction-plugin-nonce")
  const signature = request.headers.get("x-realfiction-plugin-signature")

  if (serverId && timestamp && nonce && signature) {
    const timestampNumber = Number(timestamp)

    if (!Number.isFinite(timestampNumber) || Math.abs(Date.now() - timestampNumber) > HMAC_WINDOW_MS) {
      return { ok: false, response: Response.json({ error: "Plugin signature expired." }, { status: 401 }) }
    }

    const pathname = new URL(request.url).pathname
    const signedMessage = `${serverId}.${timestamp}.${nonce}.${request.method.toUpperCase()}.${pathname}.${rawBody}`
    const expectedSignature = await hmacSha256Hex(expectedSecret, signedMessage)

    if (!constantTimeEqual(signature.toLowerCase(), expectedSignature)) {
      return { ok: false, response: Response.json({ error: "Unauthorized." }, { status: 401 }) }
    }

    // Signature is valid past this point; remaining failures are backend/infra
    // issues (missing runtime secret, DB unavailable) and must not surface as an
    // uncaught 500. They return 503 so RealCore can distinguish "retry later"
    // from a genuine auth rejection (401).
    const nonceHash = await sha256Hex(`${serverId}:${routeName}:${nonce}`)
    let nonceResult: Awaited<ReturnType<typeof insertPluginNonce>>
    try {
      nonceResult = await insertPluginNonce({
        nonce_hash: nonceHash,
        server_id: serverId,
        route: routeName,
        expires_at: new Date(Date.now() + HMAC_WINDOW_MS).toISOString()
      })
    } catch (error) {
      console.error("plugin_auth_nonce_config", { route: routeName, ...describeError(error) })
      return { ok: false, response: safeJsonError("Plugin authorization backend is not configured.", 503) }
    }

    const { error } = nonceResult

    if (error?.code === "23505" || error?.status === 409) {
      return { ok: false, response: Response.json({ error: "Plugin request replay rejected." }, { status: 401 }) }
    }

    if (error) {
      console.error("plugin_auth_nonce", { route: routeName, ...describeError(error) })
      return { ok: false, response: safeJsonError("Plugin authorization could not be verified.", 503) }
    }

    return { ok: true, mode: "hmac", serverId }
  }

  if (isSharedSecretAuthAllowed()) {
    const providedSecret = getRequestSecret(request, "x-realfiction-plugin-secret")

    if (verifySharedSecret(providedSecret, expectedSecret)) {
      return {
        ok: true,
        mode: "shared-secret",
        serverId: request.headers.get("x-realfiction-plugin-server-id") ?? "shared-secret-client"
      }
    }
  }

  return { ok: false, response: Response.json({ error: "Unauthorized." }, { status: 401 }) }
}

export function parsePluginJson(rawBody: string) {
  try {
    return JSON.parse(rawBody) as unknown
  } catch {
    return null
  }
}
