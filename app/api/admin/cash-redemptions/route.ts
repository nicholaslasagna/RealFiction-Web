// POST /api/admin/cash-redemptions — resolve a cash-redemption review.
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
// It also cannot pay anybody. Approval only moves a request to
// `manual_payout_required`; completion records an already-finished out-of-band
// payment and permanently removes the held value. No provider is called here.

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
  "isAdmin",
  "payoutReference",
  "payout_reference",
  "externalPayoutReference",
  "external_payout_reference"
]

type CurrentRequest = {
  state: string
  frozen_cents: number
}

async function readCurrentRequest(supabase: ReturnType<typeof getSupabaseServiceRoleClient>, requestId: string) {
  const { data, error } = await supabase
    .from("cash_redemption_requests")
    .select("state, frozen_cents")
    .eq("id", requestId)
    .maybeSingle()

  if (error) {
    return { ok: false as const, request: null, error }
  }
  if (!data) {
    return { ok: true as const, request: null, error: null }
  }
  return { ok: true as const, request: data as CurrentRequest, error: null }
}

async function currentState(supabase: ReturnType<typeof getSupabaseServiceRoleClient>, requestId: string) {
  const result = await readCurrentRequest(supabase, requestId)
  return result.ok ? result.request?.state ?? null : null
}

export async function POST(request: Request) {
  // Same-origin BEFORE anything else. A browser-session mutation must not be
  // reachable from another site, and this check is fail-closed.
  const sameOrigin = checkSameOrigin(request)
  if (!sameOrigin.ok) {
    console.warn("cash_redemption_resolution_cross_origin", { reason: sameOrigin.reason })
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

  const action = payload.action
  if (action !== "reject" && action !== "approve" && action !== "complete") {
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
    let paidOutCents = 0

    // Once manual payout is required, the ordinary web workflow must not
    // release the hold. The lower-level resolver retains its recovery ability,
    // but this application endpoint intentionally requires completion instead.
    if (action === "reject" || action === "approve") {
      const current = await readCurrentRequest(supabase, requestId)
      if (!current.ok) {
        console.error("cash_redemption_resolution_read_failed", { code: current.error.code ?? "unknown" })
        return safeJsonError("We could not verify that review. Please try again.", 503)
      }
      if (!current.request) {
        return safeJsonError("That review no longer exists.", 404)
      }
      if (current.request.state === "manual_payout_required") {
        return Response.json(
          { error: "Manual payout is already required. Use Record Payout Completed after the external payment." },
          { status: 409 }
        )
      }
    }

    // Completion is deliberately a two-party truth: the administrator confirms
    // the external payment, while this server reads the amount that is actually
    // frozen. A client cannot choose a payout amount, and the row lock inside the
    // resolver makes a concurrent reject/complete race resolve one way only.
    if (action === "complete") {
      const current = await readCurrentRequest(supabase, requestId)
      if (!current.ok) {
        console.error("cash_redemption_complete_read_failed", { code: current.error.code ?? "unknown" })
        return safeJsonError("We could not verify that review. Please try again.", 503)
      }
      if (!current.request) {
        return safeJsonError("That review no longer exists.", 404)
      }
      if (current.request.state !== "manual_payout_required") {
        if (current.request.state === "completed") {
          return Response.json({
            outcome: "already_completed",
            message: "That payout was already recorded."
          })
        }
        return Response.json(
          { error: "Record completion only after the review is approved for manual payout." },
          { status: 409 }
        )
      }
      paidOutCents = Number(current.request.frozen_cents)
      if (!Number.isSafeInteger(paidOutCents) || paidOutCents <= 0) {
        console.error("cash_redemption_complete_invalid_hold", { request_id: requestId })
        return safeJsonError("That review has no valid held amount to complete.", 409)
      }
    }

    const targetState = action === "reject"
      ? "rejected"
      : action === "approve"
        ? "manual_payout_required"
        : "completed"

    // THE canonical state machine. It takes the row lock and the credit-lot
    // advisory lock, applies the approved transition, and queues any existing
    // customer notification — all in one transaction.
    //
    // `p_paid_out_cents` is server-derived. Approval and rejection always pass 0;
    // completion passes the current authoritative frozen amount.
    const { data, error } = await supabase.rpc("resolve_cash_redemption", {
      p_request_id: requestId,
      p_state: targetState,
      p_note: note,
      p_paid_out_cents: paidOutCents
    })

    if (error) {
      console.error("cash_redemption_resolution_failed", { code: error.code ?? "unknown" })
      return safeJsonError("We could not close that review. Please try again.", 503)
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { outcome?: string; released_cents?: number }
      | null
    const outcome = String(row?.outcome ?? "unknown")

    console.info(`cash_redemption_${action}`, {
      request_id: requestId,
      outcome,
      paid_out_cents: paidOutCents,
      actor: staff.userId
    })

    // IDEMPOTENT. A double click, two tabs, or a request already closed in
    // another session all land here. The resolver refused to act a second time,
    // so no value was released twice — report success and let the queue
    // refresh, rather than showing an error for a state the operator wanted.
    if (outcome === "already_final") {
      const stateAfterRace = await currentState(supabase, requestId)
      if (action === "complete" && stateAfterRace === "completed") {
        return Response.json({
          outcome: "already_completed",
          message: "That payout was already recorded."
        })
      }
      return Response.json({
        outcome: "already_closed",
        message: "That review was already resolved. The queue has been refreshed."
      })
    }

    if (outcome === "not_found") {
      return safeJsonError("That review no longer exists.", 404)
    }

    if (outcome === "payout_not_authorized") {
      return Response.json(
        { error: "Record completion only after the review is approved for manual payout." },
        { status: 409 }
      )
    }

    if (outcome === "payout_amount_mismatch") {
      return Response.json(
        { error: "The payout amount no longer matches the amount held for this review." },
        { status: 409 }
      )
    }

    if (outcome !== targetState) {
      // `invalid_state` or anything unexpected. Never present a partial result
      // as success.
      console.error("cash_redemption_resolution_unexpected", { outcome, request_id: requestId })
      return safeJsonError("We could not close that review. Please try again.", 503)
    }

    if (action === "reject") {
      return Response.json({
        outcome: "rejected",
        releasedCents: Number(row?.released_cents ?? 0),
        message: "Review closed. The customer's credit is available again."
      })
    }

    if (action === "approve") {
      return Response.json({
        outcome: "manual_payout_required",
        message: "Approved for manual payout. No money was sent and the hold remains in place."
      })
    }

    return Response.json({
      outcome: "completed",
      paidOutCents,
      message: "Payout completion recorded. The held credit was consumed."
    })
  } catch {
    console.error("cash_redemption_resolution_error")
    return safeJsonError("We could not close that review. Please try again.", 503)
  }
}

/** A GET must never change a financial state. */
export async function GET() {
  return safeJsonError("Method not allowed.", 405)
}
