import "server-only"

// The application side of the abuse controls.
//
// FAIL CLOSED, EVERYWHERE
// =======================
// An earlier version of this file failed OPEN on a purchase, reasoning that a
// database hiccup should not stop a legitimate customer buying a gift card.
// That was wrong. A gift card is a stored-value instrument, and "the fraud
// controls are down" is exactly the window an attacker waits for — it converts
// a transient database problem into an interval with NO velocity limit, no
// value ceiling, and no recipient-cycling check, on the one product where those
// are load-bearing. The failure mode is not a lost sale; it is unbounded
// issuance of stored value that we then have to claw back.
//
// So every path fails closed:
//
//   evaluation unavailable -> throw. Routes answer 503, and NOTHING sensitive
//                             has run: no order, no credit reservation, no
//                             Stripe request, no value movement.
//   pepper unconfigured    -> throw, for the same reason (see below).
//   rule count unreadable  -> `block` for claims/refunds/cash requests, whose
//                             abuse cost is unbounded.
//
// A transient fraud-control failure inconveniences a customer for a few
// minutes. Failing open disables the control system.
//
// WHAT A CUSTOMER IS TOLD
// =======================
// Never the rule, never the threshold, never the count, never how long is left.
// A customer who is told "6 attempts per 10 minutes" has been handed the map.
// The rule name goes to our logs and to the review record only.

import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"
import { hashSubject, trustworthyClientIp } from "./subjects"

export type AbuseDecision = "allow" | "review" | "block"

export type AbuseSubjects = {
  actor: string
  emailHash: string | null
  ipHash: string | null
  recipientHash: string | null
}

/** The one message a blocked customer ever sees. Says nothing about why. */
export const ABUSE_BLOCKED_MESSAGE =
  "We can't process that right now. Please try again later or contact support."

/**
 * What a customer sees when the controls themselves are down or unconfigured.
 *
 * Deliberately different from the blocked message, and deliberately temporary:
 * this customer did nothing wrong and a retry in a few minutes may well work.
 * It still says nothing about fraud controls existing.
 */
export const ABUSE_UNAVAILABLE_MESSAGE =
  "Gift cards are temporarily unavailable. Please try again in a few minutes."

/**
 * The controls cannot make a decision. Every route turns this into a 503,
 * BEFORE anything sensitive happens.
 *
 * `unconfigured` is an operator problem that a deploy fixes; `unavailable` is a
 * transient database problem. They are one error because they have one correct
 * response — refuse, and let a person or a retry fix it.
 */
export class AbuseControlsUnavailableError extends Error {
  readonly reason: "unconfigured" | "unavailable"

  constructor(reason: "unconfigured" | "unavailable", detail?: string) {
    // No detail in the message itself: this can surface in a log line next to a
    // customer identifier, and the reason is enough to act on.
    super(`abuse_controls_${reason}`)
    this.name = "AbuseControlsUnavailableError"
    this.reason = reason
    if (detail) {
      console.error("abuse_controls_unavailable", { reason, detail })
    }
  }
}

function pepper() {
  return process.env.ABUSE_SUBJECT_PEPPER?.trim() || undefined
}

/**
 * The gate every gift-card path calls before doing anything that matters.
 *
 * WHY A MISSING PEPPER IS A HARD FAILURE
 * ======================================
 * Without it there is no per-IP, per-email, or per-recipient counting at all —
 * only per-account, which an attacker defeats by making accounts. Previously
 * that degraded silently, so the controls could be three-quarters off and
 * nothing would say so. A gift-card system running with most of its abuse
 * controls disabled and no signal is worse than one that refuses to run.
 *
 * There is deliberately NO fallback to unpeppered hashes: an IPv4 space is
 * 2^32, so an unpeppered hash of an address IS the address, and quietly storing
 * one to keep a feature alive would trade a availability problem for a privacy
 * one.
 */
export function assertAbuseControlsConfigured(): void {
  if (!pepper()) {
    throw new AbuseControlsUnavailableError("unconfigured", "ABUSE_SUBJECT_PEPPER is not set")
  }
}

/** True when the controls can run at all. For gates that report rather than throw. */
export function areAbuseControlsConfigured(): boolean {
  return Boolean(pepper())
}

/**
 * Resolves the subjects for a request.
 *
 * The recipient address is hashed rather than stored so that counting "how many
 * different people is this account sending to" never requires keeping a list of
 * who they are.
 */
export async function resolveSubjects(input: {
  actor: string
  request?: Request
  email?: string | null
  recipientEmail?: string | null
}): Promise<AbuseSubjects> {
  // Defence in depth. Routes call `assertAbuseControlsConfigured` explicitly and
  // early; this makes it impossible for a future caller to reach the hashing
  // path without one, rather than relying on everyone remembering.
  assertAbuseControlsConfigured()
  const key = pepper()
  const ip = input.request ? trustworthyClientIp(input.request.headers) : null

  const [emailHash, ipHash, recipientHash] = await Promise.all([
    hashSubject("email", input.email, key),
    hashSubject("ip", ip, key),
    hashSubject("recipient", input.recipientEmail, key)
  ])

  return { actor: input.actor, emailHash, ipHash, recipientHash }
}

/**
 * Writes the act down. Never throws — a counter is not worth failing a purchase
 * over, and the database function swallows its own errors as well.
 */
export async function recordAbuseEvent(
  kind: string,
  subjects: AbuseSubjects,
  amountCents = 0
): Promise<void> {
  try {
    const supabase = getSupabaseServiceRoleClient()
    await supabase.rpc("record_abuse_event", {
      p_kind: kind,
      p_actor: subjects.actor,
      p_email_hash: subjects.emailHash,
      p_ip_hash: subjects.ipHash,
      p_recipient_hash: subjects.recipientHash,
      p_amount_cents: amountCents
    })
  } catch {
    // Deliberately silent. See the contract above.
  }
}

export type VelocityVerdict = { decision: AbuseDecision; rule: string | null }

/**
 * The gift-card PURCHASE decision. FAILS CLOSED (see the header).
 *
 * Records the attempt first, so the attempt itself counts toward the next
 * evaluation even when this one allows it. Without that ordering, a burst of
 * concurrent requests would each read a count taken before any of them existed.
 *
 * Throws `AbuseControlsUnavailableError` when it cannot decide. The caller must
 * NOT catch this into an allow — the whole point is that stored value is not
 * issued while the controls are down.
 */
export async function evaluateGiftCardPurchase(
  subjects: AbuseSubjects,
  amountCents: number
): Promise<VelocityVerdict> {
  await recordAbuseEvent("gift_card_checkout", subjects, 0)

  try {
    const supabase = getSupabaseServiceRoleClient()
    const { data, error } = await supabase.rpc("evaluate_gift_card_velocity", {
      p_actor: subjects.actor,
      p_email_hash: subjects.emailHash,
      p_ip_hash: subjects.ipHash,
      p_recipient_hash: subjects.recipientHash,
      p_amount_cents: amountCents
    })

    if (error) {
      throw new AbuseControlsUnavailableError("unavailable", error.code ?? "rpc_error")
    }

    const row = (Array.isArray(data) ? data[0] : data) as { decision?: string; rule?: string } | null
    const decision = row?.decision

    // An absent or unrecognised decision is NOT an allow. It means the RPC
    // returned something we do not understand, which is indistinguishable from
    // the controls being broken.
    if (decision === "allow") {
      return { decision: "allow", rule: null }
    }
    if (decision !== "review" && decision !== "block") {
      throw new AbuseControlsUnavailableError("unavailable", "unrecognised_decision")
    }

    console.warn("abuse_velocity", { decision, rule: row?.rule, actor: subjects.actor })
    if (decision === "review") {
      await fileVelocityReview(subjects.actor, row?.rule ?? "unknown", "gift_card_checkout")
    }
    return { decision, rule: row?.rule ?? null }
  } catch (error) {
    // Rethrown, never softened. A thrown transport error and a failed RPC are
    // the same condition.
    if (error instanceof AbuseControlsUnavailableError) {
      throw error
    }
    throw new AbuseControlsUnavailableError("unavailable", "transport")
  }
}

/**
 * A single-rule check for one account. Fails CLOSED by BLOCKING rather than
 * throwing.
 *
 * Different from the purchase path on purpose: a claim or a refund that cannot
 * be counted is refused outright, which is both fail-closed and the answer the
 * customer would get anyway if they had genuinely hit the limit. There is no
 * value in distinguishing the two for them.
 */
export async function checkActorRule(
  rule: string,
  kind: string,
  actor: string
): Promise<VelocityVerdict> {
  try {
    const supabase = getSupabaseServiceRoleClient()
    const { data, error } = await supabase.rpc("evaluate_abuse_rule_for_actor", {
      p_rule: rule,
      p_kind: kind,
      p_actor: actor
    })

    if (error) {
      console.error("abuse_rule_unavailable", { rule, code: error.code })
      return { decision: "block", rule }
    }

    const row = (Array.isArray(data) ? data[0] : data) as { decision?: string } | null
    const decision = row?.decision
    if (decision !== "review" && decision !== "block") {
      return { decision: "allow", rule: null }
    }

    console.warn("abuse_rule", { decision, rule, actor })
    if (decision === "review") {
      await fileVelocityReview(actor, rule, kind)
    }
    return { decision, rule }
  } catch {
    return { decision: "block", rule }
  }
}

/** Files a deduped review item. Never throws. */
export async function fileVelocityReview(actor: string, rule: string, kind: string): Promise<void> {
  try {
    const supabase = getSupabaseServiceRoleClient()
    await supabase.rpc("record_velocity_review", { p_actor: actor, p_rule: rule, p_kind: kind })
  } catch {
    // Deliberately silent.
  }
}
