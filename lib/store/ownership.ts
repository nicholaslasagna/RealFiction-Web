import "server-only"

import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"
import {
  activeEntitlementSlugs,
  type EntitlementRecord,
  type EntitlementView
} from "@/lib/store/access-view"
import { findPrice } from "@/lib/store/catalog"

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

    // The SHARED rule, not a local copy of it. This used to inline the same
    // status-and-expiry check that the account page was missing entirely; one
    // implementation means the two pages cannot drift apart again.
    return [...activeEntitlementSlugs((data ?? []) as EntitlementRecord[])]
  } catch {
    // Ownership is a display nicety. If it cannot be read, show the store as if
    // signed out rather than failing the page.
    return []
  }
}

/**
 * The access this account currently holds, for the storefront.
 *
 * Only expiry dates: the store needs to say "Active until September 18, 2026"
 * and "adding 3 months would extend through December 18, 2026", and both come
 * from `entitlements.expires_at`. Nothing is inferred from a product's duration,
 * because a customer who stacked two purchases has more time than any single
 * duration implies.
 */
export type StorefrontAccess = { entitlements: EntitlementView[] }

export async function getStorefrontAccess(userId: string | null): Promise<StorefrontAccess> {
  if (!userId) {
    return { entitlements: [] }
  }

  try {
    const supabase = getSupabaseServiceRoleClient()
    const { data } = await supabase
      .from("entitlements")
      .select("entitlement_key,status,expires_at")
      .eq("user_id", userId)
      .eq("status", "active")

    return {
      entitlements: (data ?? []).map((row) => ({
        productId: entitlementProductId(String(row.entitlement_key)),
        expiresAt: (row.expires_at as string | null) ?? null
      }))
    }
  } catch {
    // Presentation only. If this cannot be read the store renders as if signed
    // out rather than failing the page.
    return { entitlements: [] }
  }
}

/**
 * `product:realvip-3m` -> `realvip`.
 *
 * Entitlements are keyed by the DURATION slug that was bought, but the store
 * card is per PRODUCT — so the duration suffix is stripped to group a customer's
 * 1m, 3m, 6m and 12m purchases of the same product together.
 */
function entitlementProductId(entitlementKey: string): string {
  const slug = entitlementKey.replace(/^product:/, "")
  const match = findPrice(slug)
  return match ? match.product.id : slug.replace(/-(1|3|6|12)m$/, "")
}
