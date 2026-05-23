import { z } from "zod"

import { parsePluginJson, requirePluginAuth } from "@/lib/plugin-auth"
import { describeError, safeJsonError } from "@/lib/security"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"

const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

const statSchema = z.object({
  serverId: z.string().trim().min(2).max(80),
  statKey: z.string().trim().min(2).max(80).regex(/^[a-z0-9_.-]+$/i),
  subjectType: z.string().trim().min(2).max(32).default("player"),
  limit: z.number().int().min(1).max(100).default(10),
  maxAgeSeconds: z.number().int().min(5).max(3600).default(60)
})

type LeaderboardRow = {
  position: number
  subject_id: string
  display_name: string | null
  value: number | string
  refreshed_at: string | null
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const auth = await requirePluginAuth(request, rawBody, "stats.leaderboard")

    if (!auth.ok) {
      return auth.response
    }

    const parsed = statSchema.safeParse(parsePluginJson(rawBody))

    if (!parsed.success) {
      return Response.json({ error: "Invalid stats leaderboard request." }, { status: 400 })
    }

    if (auth.mode === "hmac" && parsed.data.serverId !== auth.serverId) {
      return Response.json({ error: "Plugin server identity mismatch." }, { status: 401 })
    }

    const { data, error } = await callServiceRoleRpc<LeaderboardRow[]>("get_stat_leaderboard", {
      p_stat_key: parsed.data.statKey,
      p_subject_type: parsed.data.subjectType,
      p_limit: parsed.data.limit,
      p_max_age_seconds: parsed.data.maxAgeSeconds
    })

    if (error) {
      console.error("plugin_stats_leaderboard_rpc", describeError(error))
      const status = error.code && MISSING_SCHEMA_CODES.has(error.code) ? 503 : 500
      return safeJsonError("Stat leaderboard could not be loaded.", status)
    }

    const entries = ((data ?? []) as LeaderboardRow[]).map((row) => ({
      position: row.position,
      subjectId: row.subject_id,
      displayName: row.display_name,
      value: Number(row.value ?? 0)
    }))

    return Response.json({
      statKey: parsed.data.statKey,
      subjectType: parsed.data.subjectType,
      entries
    })
  } catch (error) {
    console.error("plugin_stats_leaderboard_error", describeError(error))
    return safeJsonError("Stat leaderboard could not be loaded.", 500)
  }
}
