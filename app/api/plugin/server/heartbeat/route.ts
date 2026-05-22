import { z } from "zod"

import { parsePluginJson, requirePluginAuth } from "@/lib/plugin-auth"
import { describeError, safeJsonError } from "@/lib/security"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"

// Postgres codes that mean the production database is missing the RealCore
// multi-server migration. Surfaced as 503 so a backend can retry rather than
// treat an unmigrated database as a hard failure.
const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

const heartbeatSchema = z.object({
  serverId: z.string().trim().min(2).max(80),
  instanceId: z.string().trim().min(8).max(64),
  serverGroup: z.string().trim().min(2).max(80).optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
  release: z.boolean().default(false)
})

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const auth = await requirePluginAuth(request, rawBody, "server.heartbeat")

    if (!auth.ok) {
      return auth.response
    }

    const parsed = heartbeatSchema.safeParse(parsePluginJson(rawBody))

    if (!parsed.success) {
      return Response.json({ error: "Invalid server heartbeat payload." }, { status: 400 })
    }

    if (auth.mode === "hmac" && parsed.data.serverId !== auth.serverId) {
      return Response.json({ error: "Plugin server identity mismatch." }, { status: 401 })
    }

    const { data, error } = await callServiceRoleRpc<Array<{
      conflict?: boolean
      active_instance?: string | null
      active_since?: string | null
    }>>("heartbeat_plugin_server", {
      p_server_id: parsed.data.serverId,
      p_instance_id: parsed.data.instanceId,
      p_server_group: parsed.data.serverGroup ?? null,
      p_display_name: parsed.data.displayName ?? null,
      p_release: parsed.data.release
    })

    if (error) {
      console.error("plugin_server_heartbeat_rpc", describeError(error))
      const status = error.code && MISSING_SCHEMA_CODES.has(error.code) ? 503 : 500
      return safeJsonError("Server heartbeat could not be recorded.", status)
    }

    const row = Array.isArray(data) ? data[0] : data
    const conflict = Boolean(row?.conflict)

    return Response.json({
      ok: !conflict,
      conflict,
      activeInstance: row?.active_instance ?? null,
      activeSince: row?.active_since ?? null
    })
  } catch (error) {
    console.error("plugin_server_heartbeat_error", describeError(error))
    return safeJsonError("Server heartbeat could not be recorded.", 500)
  }
}
