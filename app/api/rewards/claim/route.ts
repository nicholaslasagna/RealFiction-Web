import { z } from "zod"

import { safeJsonError } from "@/lib/security"
import { getAuthenticatedUser } from "@/lib/supabase/server"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

// Plugin delivery transitions (processing/delivered/failed) moved to the atomic,
// replay-protected, claimed_by_server-guarded plugin routes:
//   POST /api/plugin/rewards/poll
//   POST /api/plugin/rewards/ack
// This route is now owner-only: a signed-in user expedites delivery of their own
// pending reward by bumping available_at. It can never set a delivered status.
const rewardClaimSchema = z.object({
  rewardId: z.string().uuid(),
  action: z.literal("claim").default("claim")
})

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = rewardClaimSchema.safeParse(body)

  if (!parsed.success) {
    return Response.json(
      {
        error:
          "Invalid reward claim. Plugin delivery transitions use /api/plugin/rewards/poll and /api/plugin/rewards/ack."
      },
      { status: 400 }
    )
  }

  try {
    const user = await getAuthenticatedUser().catch(() => null)

    if (!user) {
      return Response.json({ error: "Authentication is required." }, { status: 401 })
    }

    const supabase = getSupabaseServiceRoleClient()
    const { data: reward, error } = await supabase
      .from("reward_queue")
      .select("id, status, user_id")
      .eq("id", parsed.data.rewardId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (error) {
      throw new Error("Could not load reward.")
    }

    if (!reward) {
      return Response.json({ error: "Reward not found." }, { status: 404 })
    }

    if (reward.status === "delivered") {
      return Response.json({ accepted: true, reward: { id: reward.id, status: reward.status }, duplicate: true })
    }

    if (reward.status !== "pending") {
      return Response.json({ accepted: true, reward: { id: reward.id, status: reward.status } })
    }

    const { data: updated, error: updateError } = await supabase
      .from("reward_queue")
      .update({ available_at: new Date().toISOString() })
      .eq("id", parsed.data.rewardId)
      .eq("user_id", user.id)
      .eq("status", "pending")
      .select("id, status")
      .maybeSingle()

    if (updateError) {
      throw new Error("Could not claim reward.")
    }

    return Response.json({ accepted: true, reward: updated })
  } catch (error) {
    console.error("reward_claim_error", error)
    return safeJsonError("Reward claim could not be processed.", 500)
  }
}
