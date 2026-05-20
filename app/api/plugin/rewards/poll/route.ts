import { z } from "zod"

import { parsePluginJson, requirePluginAuth } from "@/lib/plugin-auth"
import { formatRealCoreReward, type RewardQueueRow } from "@/lib/realcore-rewards"
import { safeJsonError } from "@/lib/security"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

export const runtime = "edge"

const pollSchema = z.object({
  serverId: z.string().trim().min(2).max(80),
  serverGroup: z.string().trim().min(2).max(80).default("global"),
  limit: z.number().int().min(1).max(100).default(25),
  capabilities: z.array(z.string().trim().min(2).max(80)).max(50).default([])
})

export async function POST(request: Request) {
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

  try {
    const supabase = getSupabaseServiceRoleClient()
    const { data, error } = await supabase.rpc("poll_reward_queue", {
      p_server_id: parsed.data.serverId,
      p_server_group: parsed.data.serverGroup,
      p_limit: parsed.data.limit
    })

    if (error) {
      throw new Error("Could not poll reward queue.")
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
    console.error("plugin_rewards_poll_error", error)
    return safeJsonError("Reward queue could not be polled.", 500)
  }
}
