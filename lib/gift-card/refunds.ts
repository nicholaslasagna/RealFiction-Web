import "server-only"

import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

// Application orchestration for gift-card refunds and disputes.
//
// THE INVARIANT THIS EXISTS FOR
// =============================
// A gift-card purchase is NOT an ordinary entitlement. `revoke_order` reverses
// entitlements and queues compensating RealCore rewards; it knows nothing about
// `gift_cards` or `store_credit_lots`, and a gift card is `consumable`, so for a
// gift-card order it does almost nothing — it does not invalidate the claim
// credential, does not void the card, and does not touch the stored value.
//
// Route a claimed card's refund through it and the customer gets their money
// back AND keeps the credit. So the webhook must dispatch here FIRST, and the
// ordinary path must never see a gift-card order.
//
// This module owns orchestration only. Eligibility, locking, freezing, the
// exact reversal amount, review decisions, and idempotency all stay in SQL,
// which is the only place that can hold a lock across the read and the write.

/** Result classes safe to return to a purchaser. Never leaks recipient state. */
export type GiftCardRefundOutcome =
  | "refund_started"
  | "review_required"
  | "rejected"
  | "not_a_gift_card"
  | "unavailable"

export type GiftCardRefundStart = {
  outcome: GiftCardRefundOutcome
  refundId: string | null
  /** What Stripe may be asked for. Derived from payment facts, never face value. */
  eligibleExternalCents: number
}

/**
 * The gift card a purchase order issued, or null.
 *
 * Authoritative: it asks the database which card this ORDER produced, rather
 * than trusting event metadata. A classifier a client can influence is not a
 * classifier.
 */
export async function giftCardForOrder(orderId: string): Promise<string | null> {
  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase.rpc("gift_card_for_order", { p_order_id: orderId })
  if (error) {
    // FAIL CLOSED. If we cannot tell whether this is a gift card, we must not
    // let it fall through to ordinary revocation — that is the unsafe direction.
    throw new Error("gift_card_classification_unavailable")
  }
  const value = Array.isArray(data) ? data[0] : data
  return typeof value === "string" && value ? value : null
}

/**
 * Begins a refund: evaluates eligibility under a database lock and moves the
 * card into the matching state.
 *
 * Calls no provider. An eligible unclaimed card has its credential invalidated
 * here, and an eligible claimed-unused card has its value frozen here — both
 * BEFORE Stripe is asked, so the value cannot move while the refund is in
 * flight.
 */
export async function beginGiftCardRefund(
  giftCardId: string,
  requestedCents?: number | null
): Promise<GiftCardRefundStart> {
  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase.rpc("begin_gift_card_refund", {
    p_gift_card_id: giftCardId,
    p_requested_cents: requestedCents ?? null
  })

  if (error) {
    console.error("gift_card_refund_begin_failed")
    return { outcome: "unavailable", refundId: null, eligibleExternalCents: 0 }
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { refund_id?: string; state?: string; eligible_external_cents?: number }
    | null

  const state = String(row?.state ?? "rejected")
  const outcome: GiftCardRefundOutcome =
    state === "eligible_unclaimed" || state === "eligible_claimed_unused"
      ? "refund_started"
      : state === "review_required"
        ? "review_required"
        : "rejected"

  // The STATE goes to the server log; the customer gets a coarse outcome. A
  // purchaser must not learn from a refund response whether the recipient has
  // spent anything.
  console.info("gift_card_refund_begin", { gift_card_id: giftCardId, state })

  return {
    outcome,
    refundId: (row?.refund_id as string | null) ?? null,
    eligibleExternalCents: Number(row?.eligible_external_cents ?? 0)
  }
}

/**
 * Finalises a refund the provider has CONFIRMED.
 *
 * Idempotent on the provider refund id, and bounded: the SQL refuses an amount
 * above what was eligible rather than recording the smaller number, because a
 * disagreement with Stripe about the amount is a stop-everything condition.
 */
export async function completeGiftCardRefund(input: {
  refundId: string
  providerRefundId: string
  refundedCents: number
}): Promise<{ outcome: string; reversedCents: number }> {
  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase.rpc("complete_gift_card_refund", {
    p_refund_id: input.refundId,
    p_provider_refund_id: input.providerRefundId,
    p_refunded_cents: input.refundedCents
  })

  if (error) {
    throw new Error("complete_gift_card_refund_failed")
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { outcome?: string; reversed_cents?: number }
    | null

  return {
    outcome: String(row?.outcome ?? "unknown"),
    reversedCents: Number(row?.reversed_cents ?? 0)
  }
}

/**
 * Handles a signed refund event for a gift-card purchase.
 *
 * Starts the workflow if it has not started (a refund issued from the Stripe
 * Dashboard arrives this way, with no local request), then finalises it. Both
 * halves are idempotent, so several Stripe events for one Refund produce
 * exactly one reversal.
 */
export async function handleGiftCardRefundEvent(input: {
  giftCardId: string
  providerRefundId: string
  refundedCents: number
}): Promise<{ handled: boolean; outcome: string }> {
  const supabase = getSupabaseServiceRoleClient()

  const { data: existing } = await supabase
    .from("gift_card_refunds")
    .select("id,state,eligible_external_cents")
    .eq("gift_card_id", input.giftCardId)
    .maybeSingle()

  let refundId = (existing?.id as string | undefined) ?? null
  let state = String(existing?.state ?? "")

  if (!refundId || state === "completed" || state === "rejected") {
    // No live workflow: this is a Dashboard-initiated refund. Evaluate
    // eligibility now so the same freeze/invalidate rules apply.
    const started = await beginGiftCardRefund(input.giftCardId, input.refundedCents)
    refundId = started.refundId
    state = started.outcome === "refund_started" ? "eligible" : started.outcome
  }

  if (!refundId) {
    return { handled: false, outcome: "no_refund_workflow" }
  }

  if (state === "review_required" || state === "rejected") {
    // A human owns it. The provider may still have moved money — that is
    // exactly what the review is for — but nothing is reversed automatically.
    return { handled: true, outcome: state }
  }

  const completed = await completeGiftCardRefund({
    refundId,
    providerRefundId: input.providerRefundId,
    refundedCents: input.refundedCents
  })

  console.info("gift_card_refund_event", {
    gift_card_id: input.giftCardId,
    outcome: completed.outcome
  })

  return { handled: true, outcome: completed.outcome }
}

/**
 * A dispute was opened against a gift-card purchase.
 *
 * Unclaimed: the credential dies. Claimed: what REMAINS is frozen. Already-spent
 * value is deliberately not clawed back — that would revoke products the
 * recipient is using, which is an owner decision, not a webhook's. The
 * downstream orders are linked for review instead.
 */
export async function handleGiftCardDisputeCreated(input: {
  giftCardId: string
  providerEventId: string
  disputedCents: number
}): Promise<{ outcome: string; frozenCents: number; downstreamOrders: number }> {
  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase.rpc("record_gift_card_dispute", {
    p_gift_card_id: input.giftCardId,
    p_provider_event_id: input.providerEventId,
    p_disputed_cents: input.disputedCents
  })

  if (error) {
    throw new Error("record_gift_card_dispute_failed")
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { outcome?: string; frozen_cents?: number; downstream_orders?: number }
    | null

  console.info("gift_card_dispute", {
    gift_card_id: input.giftCardId,
    outcome: String(row?.outcome ?? "unknown")
  })

  return {
    outcome: String(row?.outcome ?? "unknown"),
    frozenCents: Number(row?.frozen_cents ?? 0),
    downstreamOrders: Number(row?.downstream_orders ?? 0)
  }
}

/**
 * A dispute closed.
 *
 * Only an authoritative `won` unfreezes, and exactly once. Anything else —
 * including a status this code does not recognise — keeps the value frozen and
 * a human involved. Guessing here would either hand back value we lost or
 * strand value we won.
 */
export async function handleGiftCardDisputeClosed(input: {
  giftCardId: string
  providerEventId: string
  status: string | null
}): Promise<{ outcome: string; unfrozenCents: number }> {
  const normalized =
    input.status === "won" ? "won" : input.status === "lost" ? "lost" : "unknown"

  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase.rpc("resolve_gift_card_dispute", {
    p_gift_card_id: input.giftCardId,
    p_provider_event_id: input.providerEventId,
    p_outcome: normalized
  })

  if (error) {
    throw new Error("resolve_gift_card_dispute_failed")
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { outcome?: string; unfrozen_cents?: number }
    | null

  console.info("gift_card_dispute_closed", {
    gift_card_id: input.giftCardId,
    status: normalized,
    outcome: String(row?.outcome ?? "unknown")
  })

  return {
    outcome: String(row?.outcome ?? "unknown"),
    unfrozenCents: Number(row?.unfrozen_cents ?? 0)
  }
}

// ---------------------------------------------------------------------------
// The wired refund path
// ---------------------------------------------------------------------------

import {
  createGiftCardRefund,
  type GiftCardRefundResult
} from "@/lib/gift-card/refund-request"

export type RequestRefundOutcome =
  | "refunded"
  | "review_required"
  | "rejected"
  | "provider_failed"
  | "provider_uncertain"
  | "unavailable"

/**
 * The whole refund, start to finish.
 *
 * Order matters and is not negotiable: eligibility and the freeze happen FIRST,
 * under a database lock, and only then is Stripe asked. Asking Stripe first
 * would leave a window where the recipient can spend value that is already
 * being refunded.
 *
 * A `pending` or `uncertain` provider result deliberately does NOT unfreeze and
 * does NOT reverse. Stripe may have created the Refund and lost the response,
 * so the safe side of that uncertainty is to leave the value where it is and
 * let reconciliation settle it.
 */
export async function requestGiftCardRefund(
  giftCardId: string,
  options: {
    requestedCents?: number | null
    secretKey?: string
    fetchImpl?: typeof fetch
  } = {}
): Promise<{ outcome: RequestRefundOutcome; refundId: string | null; refundedCents: number }> {
  const started = await beginGiftCardRefund(giftCardId, options.requestedCents ?? null)

  // Not eligible: no provider call at all. A partially spent, reserved,
  // frozen, or disputed card never reaches Stripe automatically.
  if (started.outcome !== "refund_started" || !started.refundId) {
    return {
      outcome: started.outcome === "review_required" ? "review_required" : started.outcome === "unavailable" ? "unavailable" : "rejected",
      refundId: started.refundId,
      refundedCents: 0
    }
  }

  const supabase = getSupabaseServiceRoleClient()

  // Claim the provider call, so a concurrent caller cannot issue a second one.
  const { data: claimed } = await supabase.rpc("mark_gift_card_refund_pending", {
    p_refund_id: started.refundId
  })
  if (claimed !== true) {
    return { outcome: "provider_uncertain", refundId: started.refundId, refundedCents: 0 }
  }

  // Payment identity from OUR order record, never from a request.
  const { data: card } = await supabase
    .from("gift_cards")
    .select("purchaser_order_id")
    .eq("id", giftCardId)
    .maybeSingle()

  const { data: order } = await supabase
    .from("orders")
    .select("provider_payment_id,stripe_charge_id,currency")
    .eq("id", String(card?.purchaser_order_id ?? ""))
    .maybeSingle()

  const secretKey = options.secretKey ?? process.env.STRIPE_SECRET_KEY ?? ""
  if (!secretKey) {
    await supabase.rpc("fail_gift_card_refund", { p_refund_id: started.refundId, p_category: "unconfigured" })
    return { outcome: "unavailable", refundId: started.refundId, refundedCents: 0 }
  }

  let result: GiftCardRefundResult
  try {
    result = await createGiftCardRefund(
      {
        refundId: started.refundId,
        paymentIntentId: (order?.provider_payment_id as string | null) ?? null,
        chargeId: (order?.stripe_charge_id as string | null) ?? null,
        // The ceiling the database computed under a lock.
        amountCents: started.eligibleExternalCents,
        currency: String(order?.currency ?? "USD")
      },
      { secretKey, fetchImpl: options.fetchImpl }
    )
  } catch {
    return { outcome: "provider_uncertain", refundId: started.refundId, refundedCents: 0 }
  }

  if (result.kind === "succeeded") {
    const completed = await completeGiftCardRefund({
      refundId: started.refundId,
      providerRefundId: result.providerRefundId,
      refundedCents: result.amountCents
    })
    return {
      outcome: completed.outcome === "completed" || completed.outcome === "already_completed" ? "refunded" : "review_required",
      refundId: started.refundId,
      refundedCents: completed.reversedCents
    }
  }

  if (result.kind === "failed") {
    // Definitive: no money moved. Retryable, and the value stays frozen — a
    // failed refund is not a reason to make it spendable again.
    await supabase.rpc("fail_gift_card_refund", {
      p_refund_id: started.refundId,
      p_category: result.category
    })
    return { outcome: "provider_failed", refundId: started.refundId, refundedCents: 0 }
  }

  // pending or uncertain: leave it in provider_refund_pending for reconciliation.
  return { outcome: "provider_uncertain", refundId: started.refundId, refundedCents: 0 }
}
