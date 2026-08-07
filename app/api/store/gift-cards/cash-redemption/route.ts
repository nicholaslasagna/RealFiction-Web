// POST /api/store/gift-cards/cash-redemption
//
// Opens a REVIEW. It does not pay anybody, and nothing downstream of it does
// either: the terminal state a person acts on is `manual_payout_required`, and
// reaching it is a human decision made outside this system.
//
// WHY THE CLIENT SENDS ALMOST NOTHING
// ==================================
// The eligible amount is computed in the database, under the same advisory lock
// that checkout takes, from the claimant's own credit lots. A request body that
// could name an amount could name a bigger one, so this endpoint accepts an
// optional lot id and nothing else — and even that is checked to belong to the
// caller before it is used.
//
// WHAT THE CUSTOMER IS TOLD
// =========================
// That the request was received, or that there is nothing eligible. Never an
// amount (which would read as a promise to pay), never the legal reasoning, and
// never anything about who bought the card.

import { getAuthenticatedUser } from "@/lib/supabase/server"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"
import { safeJsonError } from "@/lib/security"
import {
  ABUSE_BLOCKED_MESSAGE,
  ABUSE_UNAVAILABLE_MESSAGE,
  areAbuseControlsConfigured,
  checkActorRule,
  recordAbuseEvent,
  resolveSubjects
} from "@/lib/abuse/guard"

export const dynamic = "force-dynamic"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Anything that would let a caller assert a value, an entitlement, or an
 * identity. Rejected rather than ignored: a client sending `amountCents` has
 * misunderstood what this endpoint is, and silently dropping it hides that.
 */
const FORBIDDEN = [
  "amount",
  "amountCents",
  "requestedCents",
  "eligibleCents",
  "frozenCents",
  "currency",
  "state",
  "eligible",
  "giftCardId",
  "purchaserUserId",
  "claimantUserId",
  "userId",
  "provenance"
]

export async function POST(request: Request) {
  const user = await getAuthenticatedUser().catch(() => null)
  if (!user) {
    return safeJsonError("Please sign in to request a review.", 401)
  }

  let payload: Record<string, unknown> = {}
  if (request.headers.get("content-length") !== "0") {
    try {
      payload = ((await request.json()) ?? {}) as Record<string, unknown>
    } catch {
      // An empty or unparsable body is the normal case: the endpoint needs
      // nothing. Only a body that carries a forbidden field is an error.
      payload = {}
    }
  }

  for (const field of FORBIDDEN) {
    if (payload[field] !== undefined) {
      return safeJsonError("Something in your request does not look right.", 400)
    }
  }

  const lotId = payload.lotId
  if (lotId !== undefined && (typeof lotId !== "string" || !UUID.test(lotId))) {
    return safeJsonError("Something in your request does not look right.", 400)
  }

  if (!areAbuseControlsConfigured()) {
    // Before anything is frozen and before a review is opened.
    console.error("cash_redemption_controls_unconfigured")
    return safeJsonError(ABUSE_UNAVAILABLE_MESSAGE, 503)
  }

  // Each request opens work for a person, so the throttle here is tight and
  // fails closed.
  const velocity = await checkActorRule("cash_requests_24h", "cash_redemption_request", user.id)
  await recordAbuseEvent(
    "cash_redemption_request",
    await resolveSubjects({ actor: user.id, request, email: user.email })
  )

  if (velocity.decision === "block") {
    console.warn("cash_redemption_blocked", { actor: user.id })
    return safeJsonError(ABUSE_BLOCKED_MESSAGE, 403)
  }

  try {
    const supabase = getSupabaseServiceRoleClient()
    const { data, error } = await supabase.rpc("request_cash_redemption", {
      p_claimant: user.id,
      // A lot that is not the caller's resolves to the same "nothing eligible"
      // answer inside the function, so this cannot be used to probe for lots.
      p_lot_id: typeof lotId === "string" ? lotId : null
    })

    if (error) {
      console.error("cash_redemption_rpc_error", { code: error.code ?? "unknown" })
      return safeJsonError("We could not start that review. Please try again later.", 503)
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { request_id?: string | null; state?: string; reason?: string | null }
      | null

    const state = String(row?.state ?? "ineligible")

    if (state === "ineligible") {
      // One message for "no gift credit", "not your lot", "disputed", and
      // "already spent". Distinguishing them would tell a caller which lots
      // exist and what state somebody else's card is in.
      return Response.json(
        {
          status: "not_eligible",
          message:
            "We could not find gift-card credit on your account that is eligible for a cash-redemption review."
        },
        { status: 200 }
      )
    }

    // Received, not approved. The wording is careful: no amount, no timeframe,
    // and no suggestion that a payout follows.
    return Response.json({
      status: row?.reason === "already_open" ? "already_open" : "received",
      message:
        "We have received your request and a member of our team will review it. We will email you with the outcome."
    })
  } catch {
    console.error("cash_redemption_unexpected_error")
    return safeJsonError("We could not start that review. Please try again later.", 503)
  }
}

/** A GET must never open a review. */
export async function GET() {
  return safeJsonError("Method not allowed.", 405)
}
