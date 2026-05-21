import { z } from "zod"

import {
  getRequestSecret,
  requireConfiguredSecret,
  safeJsonError,
  sha256Hex,
  verifySharedSecret
} from "@/lib/security"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

const voteWebhookSchema = z.object({
  site: z.string().trim().min(2).max(80),
  minecraftUsername: z.string().trim().min(3).max(16).regex(/^[A-Za-z0-9_]+$/),
  voteToken: z.string().trim().min(8).max(240),
  votedAt: z.string().datetime().optional()
})

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

export async function POST(request: Request) {
  let expectedSecret: string

  try {
    expectedSecret = requireConfiguredSecret("VOTE_WEBHOOK_SECRET")
  } catch {
    return safeJsonError("Vote webhook is not configured.", 503)
  }

  const providedSecret = getRequestSecret(request, "x-realfiction-vote-secret")

  if (!verifySharedSecret(providedSecret, expectedSecret)) {
    return Response.json({ error: "Unauthorized vote webhook." }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = voteWebhookSchema.safeParse(body)

  if (!parsed.success) {
    return Response.json({ error: "Invalid vote payload." }, { status: 400 })
  }

  try {
    const supabase = getSupabaseServiceRoleClient()
    const votedAt = parsed.data.votedAt ? new Date(parsed.data.votedAt) : new Date()
    const idempotencyKey = await sha256Hex(`${parsed.data.site}:${parsed.data.voteToken}`)

    const { data: siteBySlug, error: siteBySlugError } = await supabase
      .from("vote_sites")
      .select("id, slug, name, reward_key, active")
      .eq("slug", parsed.data.site)
      .eq("active", true)
      .maybeSingle()

    if (siteBySlugError) {
      throw new Error("Could not load vote site.")
    }

    const { data: siteByName, error: siteByNameError } = siteBySlug
      ? { data: null, error: null }
      : await supabase
          .from("vote_sites")
          .select("id, slug, name, reward_key, active")
          .eq("name", parsed.data.site)
          .eq("active", true)
          .maybeSingle()

    if (siteByNameError) {
      throw new Error("Could not load vote site.")
    }

    const site = siteBySlug ?? siteByName

    if (!site) {
      return Response.json({ error: "Unknown vote site." }, { status: 404 })
    }

    const { data: link } = await supabase
      .from("minecraft_account_links")
      .select("user_id, minecraft_uuid, minecraft_username")
      .eq("status", "verified")
      .ilike("minecraft_username", parsed.data.minecraftUsername)
      .maybeSingle()

    const { data: vote, error: voteError } = await supabase
      .from("votes")
      .insert({
        site_id: site.id,
        user_id: link?.user_id ?? null,
        minecraft_uuid: link?.minecraft_uuid ?? null,
        minecraft_username: parsed.data.minecraftUsername,
        provider_event_id: parsed.data.voteToken,
        idempotency_key: idempotencyKey,
        voted_at: votedAt.toISOString()
      })
      .select("id")
      .single()

    if (voteError?.code === "23505") {
      return Response.json({ accepted: true, duplicate: true })
    }

    if (voteError || !vote) {
      throw new Error("Could not persist vote.")
    }

    const key = monthKey(votedAt)
    const username = link?.minecraft_username ?? parsed.data.minecraftUsername

    const { data: streakRows } = await supabase.rpc("apply_vote_streak", {
      p_user_id: link?.user_id ?? null,
      p_minecraft_uuid: link?.minecraft_uuid ?? null,
      p_minecraft_username: username,
      p_month_key: key,
      p_voted_at: votedAt.toISOString()
    })

    const streak = Array.isArray(streakRows) ? streakRows[0] : streakRows
    const monthlyVotes = Number(streak?.monthly_votes ?? 0)

    const rewardKey = site.reward_key as string
    const { data: rewardQueue } = await supabase
      .from("reward_queue")
      .insert({
        user_id: link?.user_id ?? null,
        minecraft_uuid: link?.minecraft_uuid ?? null,
        minecraft_username: username,
        source: "vote",
        source_id: vote.id,
        reward_key: rewardKey,
        payload: {
          vote_id: vote.id,
          vote_site: site.slug,
          safe_reward: true
        },
        idempotency_key: `vote:${vote.id}`,
        status: "pending"
      })
      .select("id")
      .single()

    if (rewardQueue?.id) {
      await supabase.from("vote_rewards").insert({
        vote_id: vote.id,
        reward_queue_id: rewardQueue.id,
        reward_key: rewardKey
      })
    }

    // Cumulative monthly-vote milestones. Each successful vote increments the
    // counter by one, so an exact match fires a milestone once; the idempotency
    // key is a backstop against any reprocessing.
    const milestone = [5, 15, 30, 75].find((threshold) => threshold === monthlyVotes)
    let milestoneQueued = false

    if (milestone) {
      const { data: milestoneRow } = await supabase
        .from("reward_queue")
        .insert({
          user_id: link?.user_id ?? null,
          minecraft_uuid: link?.minecraft_uuid ?? null,
          minecraft_username: username,
          source: "vote",
          source_id: vote.id,
          reward_key: `vote.milestone.${milestone}`,
          payload: {
            vote_id: vote.id,
            vote_site: site.slug,
            milestone,
            monthly_votes: monthlyVotes,
            safe_reward: true
          },
          idempotency_key: `vote_milestone:${username.toLowerCase()}:${key}:${milestone}`,
          status: "pending"
        })
        .select("id")
        .maybeSingle()

      milestoneQueued = Boolean(milestoneRow?.id)
    }

    return Response.json({
      accepted: true,
      voteId: vote.id,
      rewardQueued: Boolean(rewardQueue?.id),
      streak: {
        current: Number(streak?.current_streak ?? 0),
        longest: Number(streak?.longest_streak ?? 0),
        monthly: monthlyVotes
      },
      milestoneQueued
    })
  } catch (error) {
    console.error("vote_webhook_error", error)
    return safeJsonError("Vote could not be processed.", 500)
  }
}
