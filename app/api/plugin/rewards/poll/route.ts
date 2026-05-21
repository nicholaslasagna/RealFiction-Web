import { z } from "zod"

import { parsePluginJson, requirePluginAuth } from "@/lib/plugin-auth"
import { formatRealCoreReward, type RewardQueueRow } from "@/lib/realcore-rewards"
import { describeError, safeJsonError } from "@/lib/security"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

export const runtime = "edge"

// Postgres error codes that mean the production database is missing the
// RealFiction migrations (undefined function / table). Surfaced as 503 with a
// clear server-side log so operators can spot an unmigrated database.
const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

const pollSchema = z.object({
  serverId: z.string().trim().min(2).max(80),
  serverGroup: z.string().trim().min(2).max(80).default("global"),
  limit: z.number().int().min(1).max(100).default(25),
  capabilities: z.array(z.string().trim().min(2).max(80)).max(50).default([])
})

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const auth = await requirePluginAuth(request, rawBody, "rewards.poll")

    if (!auth.ok) {
      return auth.response
    }

    const parsed = pollSchema.safeParse(parsePluginJson(rawBody))

    if (!parsed.success) {
      return Response.json({ error: "Invalid reward poll payload." }, { status: 400 })
    }

    if (auth.mode === "hmac" && parsed.data.serverId !== auth.serverId) {
      return Response.json({ error: "Plugin server identity mismatch." }, { status: 401 })
    }

    let supabase
    try {
      supabase = getSupabaseServiceRoleClient()
    } catch (error) {
      console.error("plugin_rewards_poll_config", describeError(error))
      return safeJsonError("Reward backend is not configured.", 503)
    }

    const { data, error } = await supabase.rpc("poll_reward_queue", {
      p_server_id: parsed.data.serverId,
      p_server_group: parsed.data.serverGroup,
      p_limit: parsed.data.limit
    })

    if (error) {
      console.error("plugin_rewards_poll_rpc", describeError(error))
      const status = error.code && MISSING_SCHEMA_CODES.has(error.code) ? 503 : 500
      return safeJsonError("Reward queue could not be polled.", status)
    }

    const rewards = ((data ?? []) as RewardQueueRow[]).map(formatRealCoreReward)

    return Response.json({
      server: {
        id: parsed.data.serverId,
        group: parsed.data.serverGroup,
        capabilities: parsed.data.capabilities
      },
      rewards
    })
  } catch (error) {
    console.error("plugin_rewards_poll_error", describeError(error))
    return safeJsonError("Reward queue could not be polled.", 500)
  }
}
