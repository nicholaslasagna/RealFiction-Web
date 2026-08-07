import "server-only"

// The application side of the abuse controls.
//
// FAIL-SAFE DIRECTION
// ===================
// "Fail safely" pulls two ways here, so it is worth being explicit about which
// way each call fails:
//
//   evaluating a PURCHASE   -> fails to `allow`. A database hiccup must not
//                              stop a legitimate customer from buying a gift
//                              card, and the act is still recorded, so the
//                              velocity is visible the moment counting works
//                              again. This is the same direction the rest of
//                              checkout already fails.
//
//   evaluating a CLAIM or a REFUND -> fails to `block`. These are the abuse
//                              paths whose cost is unbounded (brute force,
//                              repeated refunds), and refusing one attempt
//                              costs a real customer a retry.
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

function pepper() {
  return process.env.ABUSE_SUBJECT_PEPPER?.trim() || undefined
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
 * The gift-card PURCHASE decision. Fails open (see the header).
 *
 * Records the attempt first, so the attempt itself counts toward the next
 * evaluation even when this one allows it. Without that ordering, a burst of
 * concurrent requests would each read a count taken before any of them existed.
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
      console.error("abuse_velocity_unavailable", { code: error.code })
      return { decision: "allow", rule: null }
    }

    const row = (Array.isArray(data) ? data[0] : data) as { decision?: string; rule?: string } | null
    const decision = row?.decision
    if (decision !== "review" && decision !== "block") {
      return { decision: "allow", rule: null }
    }

    console.warn("abuse_velocity", { decision, rule: row?.rule, actor: subjects.actor })
    if (decision === "review") {
      await fileVelocityReview(subjects.actor, row?.rule ?? "unknown", "gift_card_checkout")
    }
    return { decision, rule: row?.rule ?? null }
  } catch {
    return { decision: "allow", rule: null }
  }
}

/**
 * A single-rule check for one account. Fails CLOSED (see the header).
 *
 * Used by the claim and refund paths, where the safe answer to "we cannot tell"
 * is "not right now".
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
