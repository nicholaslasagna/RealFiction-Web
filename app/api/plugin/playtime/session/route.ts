import { z } from "zod"

import { parsePluginJson, requirePluginAuth } from "@/lib/plugin-auth"
import { describeError, safeJsonError } from "@/lib/security"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"

// Postgres codes meaning the production database is missing the playtime
// migration; surfaced as 503 so a backend retries rather than hard-failing.
const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

const sessionSchema = z.object({
  serverId: z.string().trim().min(2).max(80),
  serverGroup: z.string().trim().min(2).max(80).default("global"),
  reconcile: z.boolean().default(false),
  events: z
    .array(
      z.object({
        type: z.enum(["start", "progress", "end"]),
        sessionId: z.string().trim().min(8).max(64),
        uuid: z.string().trim().min(8).max(48),
        username: z.string().trim().min(1).max(32).optional(),
        seconds: z.number().int().min(0).max(2_000_000).optional()
      })
    )
    .max(500)
    .default([])
})

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const auth = await requirePluginAuth(request, rawBody, "playtime.session")

    if (!auth.ok) {
      return auth.response
    }

    const parsed = sessionSchema.safeParse(parsePluginJson(rawBody))

    if (!parsed.success) {
      return Response.json({ error: "Invalid playtime payload." }, { status: 400 })
    }

    if (auth.mode === "hmac" && parsed.data.serverId !== auth.serverId) {
      return Response.json({ error: "Plugin server identity mismatch." }, { status: 401 })
    }

    const { data, error } = await callServiceRoleRpc<Array<{
      applied_events?: number
      reconciled_sessions?: number
    }>>("apply_playtime_events", {
      p_server_id: parsed.data.serverId,
      p_server_group: parsed.data.serverGroup,
      p_reconcile: parsed.data.reconcile,
      p_events: parsed.data.events.map((event) => ({
        type: event.type,
        sessionId: event.sessionId,
        uuid: event.uuid,
        username: event.username ?? null,
        seconds: event.seconds ?? 0
      }))
    })

    if (error) {
      console.error("plugin_playtime_session_rpc", describeError(error))
      const status = error.code && MISSING_SCHEMA_CODES.has(error.code) ? 503 : 500
      return safeJsonError("Playtime could not be recorded.", status)
    }

    const summary = Array.isArray(data) ? data[0] : data

    return Response.json({
      ok: true,
      applied: summary?.applied_events ?? 0,
      reconciled: summary?.reconciled_sessions ?? 0
    })
  } catch (error) {
    console.error("plugin_playtime_session_error", describeError(error))
    return safeJsonError("Playtime could not be recorded.", 500)
  }
}
