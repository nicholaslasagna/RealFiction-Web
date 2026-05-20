import { z } from "zod"

import { parsePluginJson, requirePluginAuth } from "@/lib/plugin-auth"
import { safeJsonError } from "@/lib/security"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

export const runtime = "edge"

const ackSchema = z.object({
  serverId: z.string().trim().min(2).max(80),
  deliveries: z
    .array(
      z.object({
        rewardId: z.string().uuid(),
        status: z.enum(["delivered", "failed"]),
        failureReason: z.string().trim().max(500).optional()
      })
    )
    .min(1)
    .max(100)
})

export async function POST(request: Request) {
  const rawBody = await request.text()
  const auth = await requirePluginAuth(request, rawBody, "rewards.ack")

  if (!auth.ok) {
    return auth.response
  }

  const parsed = ackSchema.safeParse(parsePluginJson(rawBody))

  if (!parsed.success) {
    return Response.json({ error: "Invalid reward acknowledgement payload." }, { status: 400 })
  }

  if (auth.mode === "hmac" && parsed.data.serverId !== auth.serverId) {
    return Response.json({ error: "Plugin server identity mismatch." }, { status: 401 })
  }

  try {
    const supabase = getSupabaseServiceRoleClient()
    const results = []

    for (const delivery of parsed.data.deliveries) {
      const { data, error } = await supabase.rpc("ack_reward_delivery", {
        p_reward_id: delivery.rewardId,
        p_server_id: parsed.data.serverId,
        p_status: delivery.status,
        p_failure_reason: delivery.failureReason ?? null
      })

      if (error) {
        results.push({
          rewardId: delivery.rewardId,
          accepted: false,
          error: "Reward acknowledgement failed."
        })
        continue
      }

      const ack = Array.isArray(data) ? data[0] : data

      results.push({
        rewardId: delivery.rewardId,
        accepted: true,
        status: ack?.status ?? delivery.status,
        deliveredAt: ack?.delivered_at ?? null,
        failedAt: ack?.failed_at ?? null,
        duplicate: Boolean(ack?.already_final)
      })
    }

    return Response.json({
      accepted: results.every((result) => result.accepted),
      results
    })
  } catch (error) {
    console.error("plugin_rewards_ack_error", error)
    return safeJsonError("Reward acknowledgement could not be processed.", 500)
  }
}
