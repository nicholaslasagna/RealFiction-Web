import { z } from "zod"

import { parsePluginJson, requirePluginAuth } from "@/lib/plugin-auth"
import { describeError, safeJsonError } from "@/lib/security"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"

const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

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
  try {
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

    const results = []

    for (const delivery of parsed.data.deliveries) {
      const { data, error } = await callServiceRoleRpc<Array<{
        ack_status?: string
        ack_delivered_at?: string | null
        ack_failed_at?: string | null
        ack_already_final?: boolean
      }>>("ack_reward_delivery", {
        p_reward_id: delivery.rewardId,
        p_server_id: parsed.data.serverId,
        p_status: delivery.status,
        p_failure_reason: delivery.failureReason ?? null
      })

      if (error) {
        console.error("plugin_rewards_ack_rpc", describeError(error))
        if (error.code && MISSING_SCHEMA_CODES.has(error.code)) {
          return safeJsonError("Reward backend is not ready.", 503)
        }
        // Surface the underlying RPC error (code + short message) to the plugin
        // log. These are Postgres/PostgREST diagnostics, not secrets, and make a
        // failing ack diagnosable in-game/server-side instead of a generic string.
        const detail = error.code ? `code ${error.code}` : "unknown error"
        const message = typeof error.message === "string" ? error.message.slice(0, 140) : ""
        results.push({
          rewardId: delivery.rewardId,
          accepted: false,
          error: `Reward ack RPC failed (${detail})${message ? `: ${message}` : ""}`
        })
        continue
      }

      const ack = Array.isArray(data) ? data[0] : data

      results.push({
        rewardId: delivery.rewardId,
        accepted: true,
        status: ack?.ack_status ?? delivery.status,
        deliveredAt: ack?.ack_delivered_at ?? null,
        failedAt: ack?.ack_failed_at ?? null,
        duplicate: Boolean(ack?.ack_already_final)
      })
    }

    return Response.json({
      accepted: results.every((result) => result.accepted),
      results
    })
  } catch (error) {
    console.error("plugin_rewards_ack_error", describeError(error))
    return safeJsonError("Reward acknowledgement could not be processed.", 500)
  }
}
