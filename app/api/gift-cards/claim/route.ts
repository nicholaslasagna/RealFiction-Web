// POST /api/gift-cards/claim
//
// The only way value moves out of a gift card and into store credit.
//
// WHY THERE IS NO GET HERE
// ========================
// Mail clients, security appliances, and link-preview bots fetch every URL in an
// email, sometimes several times. If opening a link could claim a card, a
// corporate scanner would silently consume gifts before the recipient ever read
// the message. So the claim page is a presentation-only GET, the secret travels
// in the URL FRAGMENT (which browsers never send to a server), and value moves
// only when a signed-in recipient presses a button and this route runs.
//
// The raw secret arrives in the POST body and nowhere else — not the path, not
// the query string, not a header. It is never logged, and the verifier is
// computed HERE: a client-supplied hash would make the hash the bearer token and
// undo the point of keying it.

import { getAuthenticatedUser } from "@/lib/supabase/server"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"
import { safeJsonError } from "@/lib/security"
import {
  computeClaimVerifier,
  isCanonicalClaimSecret,
  isGiftCardCryptoConfigured
} from "@/lib/gift-card/crypto"

export const dynamic = "force-dynamic"

/**
 * Result classes the browser may see.
 *
 * `invalid_or_unavailable` deliberately covers "no such credential", "already
 * consumed", "rotated away", "voided", and "refunded" alike. An account that did
 * not receive the card learns only that it cannot claim — never whether the
 * secret it tried corresponds to a real card, which would turn this route into
 * an oracle for guessing.
 */
type ClaimResult =
  | "claimed"
  | "already_claimed_by_you"
  | "invalid_or_unavailable"
  | "wrong_recipient"
  | "email_not_verified"
  | "temporarily_unavailable"
  | "rate_limited"

/** In-process failure counter. Bounded, per account. */
const failures = new Map<string, { count: number; resetAt: number }>()
const MAX_FAILURES = 10
const WINDOW_MS = 15 * 60 * 1000

function tooManyFailures(userId: string): boolean {
  const now = Date.now()
  const entry = failures.get(userId)
  if (!entry || entry.resetAt < now) {
    return false
  }
  return entry.count >= MAX_FAILURES
}

function recordFailure(userId: string) {
  const now = Date.now()
  const entry = failures.get(userId)
  if (!entry || entry.resetAt < now) {
    failures.set(userId, { count: 1, resetAt: now + WINDOW_MS })
    return
  }
  entry.count += 1
}

function reply(result: ClaimResult, extra: Record<string, unknown> = {}, status = 200) {
  return Response.json({ result, ...extra }, { status })
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser().catch(() => null)
  if (!user) {
    return safeJsonError("Please sign in to claim your gift card.", 401)
  }

  // A gift card is bound to an email address. Claiming with an unverified
  // address would let anyone who can type an address collect someone else's
  // card.
  const verifiedAt =
    (user as { email_confirmed_at?: string | null }).email_confirmed_at ??
    (user as { confirmed_at?: string | null }).confirmed_at ??
    null
  if (!verifiedAt || !user.email) {
    return reply("email_not_verified")
  }

  if (tooManyFailures(user.id)) {
    return reply("rate_limited", {}, 429)
  }

  if (!isGiftCardCryptoConfigured(process.env)) {
    // Without the pepper we cannot compute a verifier at all. Fail closed and
    // say nothing about why.
    console.error("gift_card_claim_crypto_unconfigured")
    return reply("temporarily_unavailable", {}, 503)
  }

  let secret: unknown
  try {
    const body = (await request.json()) as { secret?: unknown }
    secret = body?.secret
  } catch {
    return reply("invalid_or_unavailable")
  }

  // Shape-checked before it reaches the HMAC, so a malformed value cannot end
  // up inside a lower-level library's error message.
  if (typeof secret !== "string" || !isCanonicalClaimSecret(secret)) {
    recordFailure(user.id)
    return reply("invalid_or_unavailable")
  }

  try {
    // Computed SERVER-SIDE. The route never accepts a verifier from a client.
    const verifier = await computeClaimVerifier(secret, process.env)

    const supabase = getSupabaseServiceRoleClient()
    const { data, error } = await supabase.rpc("claim_gift_card", {
      p_verifier: verifier,
      p_user_id: user.id,
      p_user_email: user.email
    })

    if (error) {
      console.error("gift_card_claim_rpc_error", { code: error.code ?? "unknown" })
      return reply("temporarily_unavailable", {}, 503)
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { outcome?: string; amount_cents?: number; gift_card_id?: string; balance_cents?: number }
      | null

    const outcome = String(row?.outcome ?? "invalid")
    const amountCents = Number(row?.amount_cents ?? 0)
    const balanceCents = Number(row?.balance_cents ?? 0)

    // Decision only. Never the secret, the verifier, or the recipient address.
    console.info("gift_card_claim", { outcome, user_id_present: true })

    if (outcome === "claimed") {
      // No confirmation insert here, deliberately. `claim_gift_card` creates the
      // outbox row INSIDE the claim transaction, so by the time this line runs
      // the confirmation is already durable — and if it could not be written,
      // the claim rolled back and this branch was never reached.
      //
      // Doing it here instead was the previous design and it was wrong: a failed
      // insert after a committed claim left real credit with no record that it
      // had been granted, and nothing to retry.
      return reply("claimed", { amountCents, balanceCents })
    }

    if (outcome === "already_claimed_by_you") {
      return reply("already_claimed_by_you", { amountCents, balanceCents })
    }

    if (outcome === "wrong_recipient") {
      recordFailure(user.id)
      return reply("wrong_recipient")
    }

    recordFailure(user.id)
    return reply("invalid_or_unavailable")
  } catch {
    // Deliberately bare: an exception here could carry the secret in a stack
    // frame, so nothing about it is logged or returned.
    console.error("gift_card_claim_unexpected_error")
    return reply("temporarily_unavailable", {}, 503)
  }
}

/**
 * A GET must never move value.
 *
 * Present so an email scanner, a preview bot, or a curious browser receives an
 * explicit 405 rather than falling through to a framework default that might
 * one day do something else.
 */
export async function GET() {
  return Response.json(
    { error: "Claiming requires a signed-in confirmation." },
    { status: 405, headers: { Allow: "POST" } }
  )
}
