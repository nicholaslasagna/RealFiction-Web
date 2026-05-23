import { z } from "zod"

import { parsePluginJson, requirePluginAuth } from "@/lib/plugin-auth"
import { describeError, safeJsonError } from "@/lib/security"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"

const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

const leaderboardSchema = z.object({
  serverId: z.string().trim().min(2).max(80),
  // 'all' = network-wide total; otherwise a server group (lobby/smp/...).
  group: z.string().trim().min(1).max(80).default("all"),
  limit: z.number().int().min(1).max(100).default(10)
})

type LeaderboardRow = {
  minecraft_uuid: string
  minecraft_username: string | null
  total_seconds: number
  rank: number
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const auth = await requirePluginAuth(request, rawBody, "playtime.leaderboard")

    if (!auth.ok) {
      return auth.response
    }

    const parsed = leaderboardSchema.safeParse(parsePluginJson(rawBody))

    if (!parsed.success) {
      return Response.json({ error: "Invalid leaderboard request." }, { status: 400 })
    }

    if (auth.mode === "hmac" && parsed.data.serverId !== auth.serverId) {
      return Response.json({ error: "Plugin server identity mismatch." }, { status: 401 })
    }

    const { data, error } = await callServiceRoleRpc<LeaderboardRow[]>("playtime_leaderboard", {
      p_server_group: parsed.data.group,
      p_limit: parsed.data.limit
    })

    if (error) {
      console.error("plugin_playtime_leaderboard_rpc", describeError(error))
      const status = error.code && MISSING_SCHEMA_CODES.has(error.code) ? 503 : 500
      return safeJsonError("Leaderboard could not be loaded.", status)
    }

    const entries = ((data ?? []) as LeaderboardRow[]).map((row) => ({
      rank: row.rank,
      uuid: row.minecraft_uuid,
      username: row.minecraft_username,
      seconds: Number(row.total_seconds ?? 0)
    }))

    return Response.json({ group: parsed.data.group, entries })
  } catch (error) {
    console.error("plugin_playtime_leaderboard_error", describeError(error))
    return safeJsonError("Leaderboard could not be loaded.", 500)
  }
}
