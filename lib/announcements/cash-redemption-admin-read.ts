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

export type CashRedemptionQueueRead =
  | { ok: true; rows: CashRedemptionRow[] }
  | { ok: false; rows: []; reason: "unavailable" }

/**
 * Read the queue while preserving the difference between "empty" and
 * "unavailable". An unreadable financial queue must never render as zero open
 * requests to staff.
 */
export async function readCashRedemptionsForStaff(): Promise<CashRedemptionQueueRead> {
  try {
    const supabase = getSupabaseServiceRoleClient()
    const { data, error } = await supabase.rpc("staff_cash_redemption_queue", { p_limit: 200 })
    if (error || !Array.isArray(data)) {
      return { ok: false, rows: [], reason: "unavailable" }
    }

    const rows = (data as Record<string, unknown>[]).map((row) => ({
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

    // The staff queue RPC predates terminal customer notifications and reports
    // the initial `cash_redemption_received` delivery. For closed rows, read
    // the terminal outbox entry too so the page reflects what the resolver just
    // queued. This is a service-role read only; the resolver remains the sole
    // writer and exactly-once authority.
    const closedRows = rows.filter((row) => !row.isOpen)
    if (closedRows.length === 0) {
      return { ok: true, rows }
    }

    const terminalKeys = closedRows.flatMap((row) => [
      `cash_redemption_closed:${row.requestId}`,
      `cash_redemption_completed:${row.requestId}`
    ])
    const terminal = await supabase
      .from("email_deliveries")
      .select("idempotency_key, delivery_outcome")
      .in("idempotency_key", terminalKeys)

    if (terminal.error || !Array.isArray(terminal.data)) {
      return {
        ok: true,
        rows: rows.map((row) =>
          row.isOpen ? row : { ...row, customerNotified: "status_unavailable" }
        )
      }
    }

    const terminalOutcomes = new Map(
      (terminal.data as Array<{ idempotency_key?: unknown; delivery_outcome?: unknown }>).map((entry) => [
        String(entry.idempotency_key),
        String(entry.delivery_outcome ?? "not_queued")
      ])
    )

    return {
      ok: true,
      rows: rows.map((row) => {
        if (row.isOpen) {
          return row
        }
        const closed = terminalOutcomes.get(`cash_redemption_closed:${row.requestId}`)
        const completed = terminalOutcomes.get(`cash_redemption_completed:${row.requestId}`)
        return { ...row, customerNotified: closed ?? completed ?? "not_queued" }
      })
    }
  } catch {
    return { ok: false, rows: [], reason: "unavailable" }
  }
}

/** Backward-compatible row-only helper for existing staff-only readers/tests. */
export async function listCashRedemptionsForStaff(): Promise<CashRedemptionRow[]> {
  const result = await readCashRedemptionsForStaff()
  return result.rows
}
