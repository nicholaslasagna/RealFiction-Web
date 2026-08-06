import "server-only"

import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

/**
 * Product ids this account currently owns, resolved SERVER-SIDE from
 * entitlements.
 *
 * The storefront uses this only to stop inviting someone to re-buy what they
 * already have. It is never the authority for a purchase: checkout re-resolves
 * price, eligibility, and entitlement state on the server regardless of what
 * the browser was shown.
 */
export async function getOwnedProductIds(userId: string | null): Promise<string[]> {
  if (!userId) {
    return []
  }

  try {
    const supabase = getSupabaseServiceRoleClient()
    const { data } = await supabase
      .from("entitlements")
      .select("entitlement_key,status,expires_at")
      .eq("user_id", userId)
      .eq("status", "active")

    const now = Date.now()
    return (data ?? [])
      .filter((row) => {
        const expiry = row.expires_at as string | null
        // A permanent grant has no expiry; a term grant counts only while live.
        return !expiry || Date.parse(expiry) > now
      })
      .map((row) => String(row.entitlement_key).replace(/^product:/, ""))
  } catch {
    // Ownership is a display nicety. If it cannot be read, show the store as if
    // signed out rather than failing the page.
    return []
  }
}
