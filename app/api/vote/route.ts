import { z } from "zod"

import {
  getRequestSecret,
  requireConfiguredSecret,
  safeJsonError,
  sha256Hex,
  verifySharedSecret
} from "@/lib/security"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

export const runtime = "edge"

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

    const { data: streak } = await supabase
      .from("vote_streaks")
      .select("id, monthly_votes, total_votes")
      .eq("minecraft_username", username)
      .eq("month_key", key)
      .maybeSingle()

    if (streak) {
      await supabase
        .from("vote_streaks")
        .update({
          monthly_votes: Number(streak.monthly_votes ?? 0) + 1,
          total_votes: Number(streak.total_votes ?? 0) + 1,
          last_vote_at: votedAt.toISOString(),
          user_id: link?.user_id ?? null,
          minecraft_uuid: link?.minecraft_uuid ?? null
        })
        .eq("id", streak.id)
    } else {
      await supabase.from("vote_streaks").insert({
        user_id: link?.user_id ?? null,
        minecraft_uuid: link?.minecraft_uuid ?? null,
        minecraft_username: username,
        current_streak: 1,
        longest_streak: 1,
        monthly_votes: 1,
        total_votes: 1,
        last_vote_at: votedAt.toISOString(),
        month_key: key
      })
    }

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

    return Response.json({
      accepted: true,
      voteId: vote.id,
      rewardQueued: Boolean(rewardQueue?.id)
    })
  } catch (error) {
    console.error("vote_webhook_error", error)
    return safeJsonError("Vote could not be processed.", 500)
  }
}
