import { safeJsonError } from "@/lib/security"
import { getAuthenticatedUser } from "@/lib/supabase/server"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

export async function POST() {
  const user = await getAuthenticatedUser().catch(() => null)

  if (!user) {
    return Response.json({ error: "Authentication is required." }, { status: 401 })
  }

  try {
    const supabase = getSupabaseServiceRoleClient()

    // Revokes every verified link for this user, strips the live cosmetic/supporter
    // grants from each Minecraft account, and detaches (keeps) their entitlements
    // so a future linked account can receive them for the remaining duration.
    const { data, error } = await supabase.rpc("unlink_minecraft_account", {
      p_user_id: user.id
    })

    if (error) {
      throw new Error("Could not unlink Minecraft account.")
    }

    const summary = Array.isArray(data) ? data[0] : data

    return Response.json({
      unlinked: true,
      unlinkedLinks: Number(summary?.unlinked_links ?? 0),
      queuedRevokes: Number(summary?.queued_revokes ?? 0)
    })
  } catch (error) {
    console.error("account_link_unlink_error", error)
    return safeJsonError("Could not unlink Minecraft account.", 500)
  }
}
