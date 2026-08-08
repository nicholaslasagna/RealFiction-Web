// POST /api/admin/cash-redemptions — close a cash-redemption review.
//
// WHAT THIS ENDPOINT IS NOT
// =========================
// It is not an accounting implementation. Releasing a hold means moving frozen
// cents back to spendable, and that arithmetic lives in exactly one place:
// `resolve_cash_redemption`, under the same advisory locks that protect every
// other path touching a credit lot. This route validates who is asking and what
// they asked for, then calls it. It never UPDATEs
// `cash_redemption_requests`, `store_credit_lots`, or `store_credit_ledger`.
//
// It also cannot pay anybody. The only state it will send is `rejected`;
// `completed` is a materially different workflow (it permanently removes
// redeemed value after an out-of-band payment) and is deliberately absent.

import { requireStaff } from "@/lib/auth/staff"
import { checkSameOrigin } from "@/lib/auth/same-origin"
import { safeJsonError } from "@/lib/security"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

export const dynamic = "force-dynamic"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const NOTE_MIN = 3
const NOTE_MAX = 500

// Keep ordinary whitespace usable in a note, but reject characters that are
// not meaningful review text and can make logs, exports, or downstream tooling
// ambiguous. PostgreSQL text cannot store NUL, and the remaining C0 controls
// have no place in an operator note.
const DISALLOWED_NOTE_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

/**
 * Fields a client must never assert. Rejected rather than ignored: a caller
 * sending `paidOutCents` has misunderstood what this endpoint is, and silently
 * dropping it would hide that.
 */
const FORBIDDEN = [
  "state",
  "paidOutCents",
  "paid_out_cents",
  "frozenCents",
  "frozen_cents",
  "requestedCents",
  "claimantUserId",
  "userId",
  "role",
  "isAdmin"
]

export async function POST(request: Request) {
  // Same-origin BEFORE anything else. A browser-session mutation must not be
  // reachable from another site, and this check is fail-closed.
  const sameOrigin = checkSameOrigin(request)
  if (!sameOrigin.ok) {
    console.warn("cash_redemption_reject_cross_origin", { reason: sameOrigin.reason })
    return safeJsonError("Something in your request does not look right.", 403)
  }

  const staff = await requireStaff()
  if (!staff.ok) {
    if (staff.reason === "unavailable") {
      // Fail closed. An unreachable database is not permission.
      return safeJsonError("We could not verify your access.", 503)
    }
    // Signed-out and not-staff answer identically, so this cannot be used to
    // discover who holds the role.
    return safeJsonError("Not found.", 404)
  }

  let payload: Record<string, unknown>
  try {
    payload = ((await request.json()) ?? {}) as Record<string, unknown>
  } catch {
    return safeJsonError("Something in your request does not look right.", 400)
  }

  for (const field of FORBIDDEN) {
    if (payload[field] !== undefined) {
      return safeJsonError("Something in your request does not look right.", 400)
    }
  }

  if (payload.action !== "reject") {
    // The ONLY action. `completed` is not reachable from this surface.
    return safeJsonError("Something in your request does not look right.", 400)
  }

  const requestId = payload.requestId
  if (typeof requestId !== "string" || !UUID.test(requestId)) {
    return safeJsonError("Something in your request does not look right.", 400)
  }

  const note = typeof payload.reviewNote === "string" ? payload.reviewNote.trim() : ""
  if (note.length < NOTE_MIN) {
    return Response.json(
      { error: "Add a short note explaining the decision.", field: "reviewNote" },
      { status: 400 }
    )
  }
  if (note.length > NOTE_MAX) {
    return Response.json(
      { error: "That note is too long.", field: "reviewNote" },
      { status: 400 }
    )
  }
  if (DISALLOWED_NOTE_CONTROLS.test(note)) {
    return Response.json(
      { error: "Use ordinary text for the review note.", field: "reviewNote" },
      { status: 400 }
    )
  }

  try {
    const supabase = getSupabaseServiceRoleClient()

    // THE canonical state machine. It takes the row lock and the credit-lot
    // advisory lock, releases exactly `frozen_cents`, records the decision, and
    // queues the customer's closure email — all in one transaction.
    //
    // `p_paid_out_cents` is 0 and is not client-supplied. A rejection never pays.
    const { data, error } = await supabase.rpc("resolve_cash_redemption", {
      p_request_id: requestId,
      p_state: "rejected",
      p_note: note,
      p_paid_out_cents: 0
    })

    if (error) {
      console.error("cash_redemption_reject_failed", { code: error.code ?? "unknown" })
      return safeJsonError("We could not close that review. Please try again.", 503)
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { outcome?: string; released_cents?: number }
      | null
    const outcome = String(row?.outcome ?? "unknown")

    console.info("cash_redemption_rejected", {
      request_id: requestId,
      outcome,
      released_cents: row?.released_cents,
      actor: staff.userId
    })

    // IDEMPOTENT. A double click, two tabs, or a request already closed in
    // another session all land here. The resolver refused to act a second time,
    // so no value was released twice — report success and let the queue
    // refresh, rather than showing an error for a state the operator wanted.
    if (outcome === "already_final") {
      return Response.json({
        outcome: "already_closed",
        releasedCents: 0,
        message: "That review was already closed. The queue has been refreshed."
      })
    }

    if (outcome === "not_found") {
      return safeJsonError("That review no longer exists.", 404)
    }

    if (outcome !== "rejected") {
      // `invalid_state` or anything unexpected. Never present a partial result
      // as success.
      console.error("cash_redemption_reject_unexpected", { outcome, request_id: requestId })
      return safeJsonError("We could not close that review. Please try again.", 503)
    }

    return Response.json({
      outcome: "rejected",
      releasedCents: Number(row?.released_cents ?? 0),
      message: "Review closed. The customer's credit is available again."
    })
  } catch {
    console.error("cash_redemption_reject_error")
    return safeJsonError("We could not close that review. Please try again.", 503)
  }
}

/** A GET must never change a financial state. */
export async function GET() {
  return safeJsonError("Method not allowed.", 405)
}
