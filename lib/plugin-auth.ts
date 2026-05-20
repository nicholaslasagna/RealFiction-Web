import "server-only"

import {
  constantTimeEqual,
  getRequestSecret,
  isSharedSecretAuthAllowed,
  requireConfiguredSecret,
  safeJsonError,
  sha256Hex,
  verifySharedSecret
} from "@/lib/security"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

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

    const nonceHash = await sha256Hex(`${serverId}:${routeName}:${nonce}`)
    const supabase = getSupabaseServiceRoleClient()
    const { error } = await supabase.from("plugin_request_nonces").insert({
      nonce_hash: nonceHash,
      server_id: serverId,
      route: routeName,
      expires_at: new Date(Date.now() + HMAC_WINDOW_MS).toISOString()
    })

    if (error?.code === "23505") {
      return { ok: false, response: Response.json({ error: "Plugin request replay rejected." }, { status: 401 }) }
    }

    if (error) {
      return { ok: false, response: safeJsonError("Plugin authorization could not be verified.", 500) }
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
