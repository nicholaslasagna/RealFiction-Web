import "server-only"

import { sha256Hex } from "@/lib/security"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

export type ConfirmMinecraftLinkInput = {
  verificationCode: string
  minecraftUuid: string
  minecraftUsername: string
  platform: "java" | "bedrock"
}

export async function confirmMinecraftAccountLink(input: ConfirmMinecraftLinkInput) {
  const supabase = getSupabaseServiceRoleClient()
  const codeHash = await sha256Hex(input.verificationCode)
  const now = new Date().toISOString()

  await supabase
    .from("minecraft_account_links")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("expires_at", now)

  const { data: link, error: linkError } = await supabase
    .from("minecraft_account_links")
    .select("id, user_id, minecraft_username, platform, expires_at")
    .eq("verification_code_hash", codeHash)
    .eq("minecraft_username", input.minecraftUsername)
    .eq("platform", input.platform)
    .eq("status", "pending")
    .gt("expires_at", now)
    .maybeSingle()

  if (linkError) {
    throw new Error("Could not verify link request.")
  }

  if (!link) {
    return null
  }

  const { data: updatedLink, error: updateError } = await supabase
    .from("minecraft_account_links")
    .update({
      minecraft_uuid: input.minecraftUuid,
      minecraft_username: input.minecraftUsername,
      status: "verified",
      verified_at: now,
      verification_code: "verified",
      verification_code_hash: null
    })
    .eq("id", link.id)
    .eq("status", "pending")
    .select("id, user_id")
    .maybeSingle()

  if (updateError || !updatedLink) {
    throw new Error("Could not finalize link request.")
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      primary_minecraft_uuid: input.minecraftUuid,
      primary_minecraft_username: input.minecraftUsername
    })
    .eq("id", link.user_id)

  if (profileError) {
    throw new Error("Could not update linked profile.")
  }

  return {
    userId: link.user_id as string,
    minecraftUuid: input.minecraftUuid,
    minecraftUsername: input.minecraftUsername,
    platform: input.platform
  }
}
