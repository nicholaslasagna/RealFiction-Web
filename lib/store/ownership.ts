import "server-only"

import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"
import type { EntitlementSource, EntitlementView, UpgradeQuoteView } from "@/lib/store/ownership-view"

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

/**
 * The full server-authoritative view the storefront renders from: what this
 * account holds, with real expiry dates and real provenance, plus the upgrade
 * quote.
 *
 * Every number the customer is shown for the upgrade comes from
 * `compute_upgrade_price`. Nothing is derived in the browser, and nothing is
 * derived here either — this only reshapes what the database said.
 */
export type StorefrontOwnership = {
  entitlements: EntitlementView[]
  upgrade: UpgradeQuoteView | null
}

const EMPTY: StorefrontOwnership = { entitlements: [], upgrade: null }

function readSource(value: unknown): EntitlementSource {
  return value === "order" || value === "inclusion" || value === "manual_grant" ? value : "unknown"
}

export async function getStorefrontOwnership(
  userId: string | null,
  upgradeTargetSlug = "real-supporter-permanent"
): Promise<StorefrontOwnership> {
  if (!userId) {
    return EMPTY
  }

  try {
    const supabase = getSupabaseServiceRoleClient()

    const { data: rows } = await supabase
      .from("entitlements")
      .select("entitlement_key,status,expires_at,metadata")
      .eq("user_id", userId)
      .eq("status", "active")

    const now = Date.now()
    const entitlements: EntitlementView[] = (rows ?? [])
      .filter((row) => {
        const expiry = row.expires_at as string | null
        return !expiry || Date.parse(expiry) > now
      })
      .map((row) => ({
        productId: String(row.entitlement_key).replace(/^product:/, ""),
        expiresAt: (row.expires_at as string | null) ?? null,
        source: readSource((row.metadata as Record<string, unknown> | null)?.source)
      }))

    // The quote. A failure here means NO upgrade is offered — never a guess.
    const { data: quoteRows, error: quoteError } = await supabase.rpc("compute_upgrade_price", {
      p_user_id: userId,
      p_to_slug: upgradeTargetSlug
    })

    if (quoteError) {
      return { entitlements, upgrade: null }
    }

    const quote = (Array.isArray(quoteRows) ? quoteRows[0] : quoteRows) as Record<string, unknown> | null
    if (!quote) {
      return { entitlements, upgrade: null }
    }

    // `eligible_upgrade_sources` excludes anything already reserved or in
    // review, so an ineligible quote alone cannot tell "you have no paid
    // RealVIP" from "your credit is held by another checkout". Those need
    // different words, so the ledger is consulted directly.
    let hold: UpgradeQuoteView["hold"] = "none"
    if (quote.eligible !== true) {
      const { data: heldRows } = await supabase
        .from("upgrade_credit_reservations")
        .select("state")
        .eq("user_id", userId)
        .eq("to_slug", upgradeTargetSlug)
        .in("state", ["reserved", "needs_review"])

      const states = new Set((heldRows ?? []).map((row) => String(row.state)))
      if (states.has("needs_review")) {
        hold = "needs_review"
      } else if (states.has("reserved")) {
        hold = "reserved"
      }
    }

    return {
      entitlements,
      upgrade: {
        eligible: quote.eligible === true,
        reason: String(quote.reason ?? "unknown"),
        targetPriceCents: Number(quote.target_price_cents ?? 0),
        creditCents: Number(quote.credit_cents ?? 0),
        upgradePriceCents: Number(quote.upgrade_price_cents ?? 0),
        hold
      }
    }
  } catch {
    // Presentation only. A failure shows the store as if signed out rather than
    // failing the page — and offers no upgrade, which is the safe direction.
    return EMPTY
  }
}
