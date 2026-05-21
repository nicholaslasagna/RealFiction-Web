import { z } from "zod"

import { createVerificationCode, safeJsonError, sha256Hex } from "@/lib/security"
import { getAuthenticatedUser } from "@/lib/supabase/server"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"
import { ensureProfileForUser } from "@/lib/store-server"

const startLinkSchema = z.object({
  minecraftUsername: z.string().trim().min(3).max(16).regex(/^[A-Za-z0-9_]+$/),
  platform: z.enum(["java", "bedrock"]).default("java")
})

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = startLinkSchema.safeParse(body)

  if (!parsed.success) {
    return Response.json({ error: "Invalid Minecraft account link request." }, { status: 400 })
  }

  const user = await getAuthenticatedUser().catch(() => null)

  if (!user) {
    return Response.json({ error: "Authentication is required." }, { status: 401 })
  }

  try {
    await ensureProfileForUser(user)

    const supabase = getSupabaseServiceRoleClient()
    const code = createVerificationCode()
    const codeHash = await sha256Hex(code)
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString()

    const { data: existingLink, error: existingError } = await supabase
      .from("minecraft_account_links")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("minecraft_username", parsed.data.minecraftUsername)
      .eq("platform", parsed.data.platform)
      .maybeSingle()

    if (existingError) {
      throw new Error("Could not inspect existing link request.")
    }

    if (existingLink?.status === "verified") {
      return Response.json({ error: "Minecraft account is already linked." }, { status: 409 })
    }

    if (existingLink?.status === "revoked") {
      return Response.json({ error: "Minecraft account link is revoked." }, { status: 409 })
    }

    await supabase
      .from("minecraft_account_links")
      .update({ status: "expired" })
      .eq("user_id", user.id)
      .eq("minecraft_username", parsed.data.minecraftUsername)
      .eq("platform", parsed.data.platform)
      .eq("status", "pending")

    const { data, error } = await supabase
      .from("minecraft_account_links")
      .upsert({
        user_id: user.id,
        minecraft_username: parsed.data.minecraftUsername,
        platform: parsed.data.platform,
        verification_code: "server-hashed",
        verification_code_hash: codeHash,
        status: "pending",
        expires_at: expiresAt,
        minecraft_uuid: null,
        verified_at: null
      }, { onConflict: "user_id,minecraft_username,platform" })
      .select("id, minecraft_username, platform, expires_at")
      .single()

    if (error || !data) {
      throw new Error("Could not create link request.")
    }

    return Response.json({
      linkRequest: {
        id: data.id,
        minecraftUsername: data.minecraft_username,
        platform: data.platform,
        expiresAt: data.expires_at,
        verificationCode: code,
        command: `/realfiction link ${code}`
      }
    })
  } catch (error) {
    console.error("account_link_start_error", error)
    return safeJsonError("Could not start Minecraft account linking.", 500)
  }
}
