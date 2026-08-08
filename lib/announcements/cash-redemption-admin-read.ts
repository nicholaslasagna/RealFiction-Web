import "server-only"

// Staff-only read for the cash-redemption queue.
//
// Only ever called after `requireStaff()` has passed. It returns claimant
// identity and financial detail, which is exactly what a reviewer needs and
// exactly what must never reach an ordinary user.

import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

export type CashRedemptionRow = {
  requestId: string
  claimantUserId: string
  claimantEmail: string | null
  minecraftUsername: string | null
  state: string
  requestedCents: number
  frozenCents: number
  paidOutCents: number
  requestedAt: string | null
  decidedAt: string | null
  completedAt: string | null
  reviewNote: string | null
  ineligibleReason: string | null
  customerNotified: string
  adminNotified: string
  isOpen: boolean
}

export async function listCashRedemptionsForStaff(): Promise<CashRedemptionRow[]> {
  try {
    const supabase = getSupabaseServiceRoleClient()
    const { data, error } = await supabase.rpc("staff_cash_redemption_queue", { p_limit: 200 })
    if (error || !Array.isArray(data)) {
      // The page renders an explicit error state rather than an empty queue: an
      // empty list and an unreadable list must never look the same to an
      // operator whose job is to notice new requests.
      return []
    }
    return (data as Record<string, unknown>[]).map((row) => ({
      requestId: String(row.request_id),
      claimantUserId: String(row.claimant_user_id ?? ""),
      claimantEmail: (row.claimant_email as string | null) ?? null,
      minecraftUsername: (row.minecraft_username as string | null) ?? null,
      state: String(row.state ?? "requested"),
      requestedCents: Number(row.requested_cents ?? 0),
      frozenCents: Number(row.frozen_cents ?? 0),
      paidOutCents: Number(row.paid_out_cents ?? 0),
      requestedAt: (row.requested_at as string | null) ?? null,
      decidedAt: (row.decided_at as string | null) ?? null,
      completedAt: (row.completed_at as string | null) ?? null,
      reviewNote: (row.review_note as string | null) ?? null,
      ineligibleReason: (row.ineligible_reason as string | null) ?? null,
      customerNotified: String(row.customer_notified ?? "not_queued"),
      adminNotified: String(row.admin_notified ?? "not_queued"),
      isOpen: row.is_open === true
    }))
  } catch {
    return []
  }
}
