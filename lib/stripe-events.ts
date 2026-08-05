// Pure Stripe webhook decision logic.
//
// This module intentionally does NOT import "server-only" or any Supabase/network
// client, so every branch below is unit-testable under `node --test`. It decides
// WHAT should happen for an event; the route performs the effects.
//
// Payload shapes follow Stripe API version 2026-04-22.dahlia (Snapshot payloads).
// The project deliberately uses no Stripe SDK, so these are structural reads of
// the documented fields only — never a version-specific SDK type.

/** Minimal structural view of a Stripe event. */
export type StripeEventLike = {
  id?: string
  type?: string
  livemode?: boolean
  data?: { object?: Record<string, unknown> }
}

export type StripeEnvironment = "live" | "test"

/**
 * Environment gate. Fails CLOSED: an unset or unrecognised STRIPE_ENVIRONMENT
 * rejects every event rather than guessing, so a misconfigured deploy can never
 * let test-mode objects touch production orders.
 */
export function resolveStripeEnvironment(value: string | undefined): StripeEnvironment | null {
  const normalized = (value ?? "").trim().toLowerCase()
  if (normalized === "live") return "live"
  if (normalized === "test") return "test"
  return null
}

export type LivemodeCheck = { ok: true } | { ok: false; reason: string }

/**
 * `event.livemode` must match the configured environment exactly. In live
 * production this is what stops a test-mode event (or a replayed test webhook)
 * from mutating real orders.
 */
export function checkLivemode(event: StripeEventLike, environment: StripeEnvironment | null): LivemodeCheck {
  if (environment === null) {
    return { ok: false, reason: "stripe_environment_unconfigured" }
  }
  if (typeof event.livemode !== "boolean") {
    return { ok: false, reason: "livemode_missing" }
  }
  const expected = environment === "live"
  if (event.livemode !== expected) {
    return { ok: false, reason: `livemode_mismatch_expected_${expected}` }
  }
  return { ok: true }
}

// -- Event classification ----------------------------------------------------

/**
 * Durable operation key for a revocation, derived from the REFUND/DISPUTE
 * object id — not the Stripe event id.
 *
 * Stripe emits several distinct event ids for one refund (`refund.created` then
 * one or more `refund.updated`), and each carries a different `event.id`, so
 * event-id deduplication alone would let the same refund revoke an order
 * repeatedly. Keying on the object id collapses them all onto one operation.
 */
export function revocationOperationKey(object: Record<string, unknown>, mode: "refund" | "chargeback"): string | null {
  const objectId = typeof object.id === "string" && object.id ? object.id : null
  if (!objectId) {
    return null
  }
  return `${mode}:${objectId}`
}

export type StripeAction =
  /** Payment is settled: fulfil idempotently. */
  | { kind: "fulfill"; orderId: string; paymentIntentId: string | null }
  /** Session completed but payment still processing — keep the pending order. */
  | { kind: "await_async_payment"; orderId: string }
  /** Order will never be paid: cancel + release reserved store credit once. */
  | { kind: "release"; orderId: string; reason: "payment_failed" | "expired" }
  /** Refund/dispute resolved against us: revoke access. */
  | { kind: "revoke"; orderId: string | null; mode: "refund" | "chargeback"; reason: string; paymentIntentId: string | null; operationKey: string | null }
  /** Needs a human: recorded for audit, never auto-applied. */
  | { kind: "manual_review"; reason: string; paymentIntentId: string | null; detail: Record<string, unknown> }
  /** Recorded for audit only; no state change. */
  | { kind: "record_only"; reason: string }
  /** Event type we do not act on. */
  | { kind: "ignore"; reason: string }

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

function readMetadata(source: Record<string, unknown>): Record<string, string | undefined> {
  const metadata = source.metadata
  return metadata && typeof metadata === "object" ? (metadata as Record<string, string | undefined>) : {}
}

/** Order id from session metadata, falling back to client_reference_id. */
export function orderIdFromSession(session: Record<string, unknown>): string | null {
  const metadata = readMetadata(session)
  const fromMetadata = typeof metadata.order_id === "string" && metadata.order_id ? metadata.order_id : null
  return fromMetadata ?? readString(session, "client_reference_id")
}

/**
 * How a refund amount maps onto the order we charged.
 *
 * `full` is the only case safe to auto-revoke. A partial refund is reported with
 * the matching item when exactly one order item's total equals the refunded
 * amount, but Phase 1 still routes BOTH partial cases to manual review: the
 * existing revoke_order RPC revokes a whole order, and silently revoking a
 * multi-item order for a partial refund would take away access the customer
 * still paid for.
 */
export type RefundScope =
  | { kind: "full" }
  | { kind: "partial"; unambiguousOrderItemId: string | null }
  | { kind: "unknown" }

export function classifyRefundScope(
  refundedAmountCents: number,
  orderPaidCents: number | null,
  items: ReadonlyArray<{ id: string; totalCents: number }>
): RefundScope {
  if (!Number.isFinite(refundedAmountCents) || refundedAmountCents <= 0 || orderPaidCents === null) {
    return { kind: "unknown" }
  }
  if (refundedAmountCents >= orderPaidCents) {
    return { kind: "full" }
  }
  const matches = items.filter((item) => item.totalCents === refundedAmountCents)
  return { kind: "partial", unambiguousOrderItemId: matches.length === 1 ? matches[0].id : null }
}

/**
 * Classifies an event into the action the route should take.
 *
 * Refund and dispute events need order/amount context the route must look up, so
 * they resolve to `revoke`/`manual_review` with a null orderId that the route
 * fills in from trusted server-side records (never from event metadata alone).
 */
export function classifyStripeEvent(event: StripeEventLike): StripeAction {
  const object = (event.data?.object ?? {}) as Record<string, unknown>
  const type = event.type ?? ""

  switch (type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const orderId = orderIdFromSession(object)
      if (!orderId) {
        return { kind: "ignore", reason: "session_without_order_id" }
      }
      const paymentStatus = readString(object, "payment_status")
      // Only `paid` (or `no_payment_required`, i.e. fully covered) may fulfil.
      // `unpaid` means a delayed method is still processing: keep the pending
      // order and wait for async_payment_succeeded.
      if (paymentStatus === "paid" || paymentStatus === "no_payment_required") {
        return { kind: "fulfill", orderId, paymentIntentId: readString(object, "payment_intent") }
      }
      return { kind: "await_async_payment", orderId }
    }

    case "checkout.session.async_payment_failed": {
      const orderId = orderIdFromSession(object)
      if (!orderId) {
        return { kind: "ignore", reason: "session_without_order_id" }
      }
      return { kind: "release", orderId, reason: "payment_failed" }
    }

    case "checkout.session.expired": {
      const orderId = orderIdFromSession(object)
      if (!orderId) {
        return { kind: "ignore", reason: "session_without_order_id" }
      }
      return { kind: "release", orderId, reason: "expired" }
    }

    case "refund.created":
    case "refund.updated": {
      const status = readString(object, "status")
      const paymentIntentId = readString(object, "payment_intent")
      // A created/pending refund is NOT a reason to revoke — only a settled one.
      if (status !== "succeeded") {
        return { kind: "record_only", reason: `refund_${status ?? "unknown"}` }
      }
      return {
        kind: "revoke",
        orderId: null,
        mode: "refund",
        reason: `stripe:${type}:succeeded`,
        paymentIntentId,
        // Keyed on the REFUND id, so refund.created + refund.updated + any
        // replay of either collapse onto one revocation operation.
        operationKey: revocationOperationKey(object, "refund")
      }
    }

    case "refund.failed": {
      // A failed refund must never remove access — the customer still paid.
      return { kind: "record_only", reason: "refund_failed" }
    }

    case "charge.dispute.created": {
      return {
        kind: "revoke",
        orderId: null,
        mode: "chargeback",
        reason: "stripe:charge.dispute.created",
        paymentIntentId: readString(object, "payment_intent"),
        // Keyed on the DISPUTE id: created + repeated updates + closed(lost)
        // for one dispute are a single revocation.
        operationKey: revocationOperationKey(object, "chargeback")
      }
    }

    case "charge.dispute.closed": {
      const status = readString(object, "status")
      if (status === "lost") {
        // Already revoked at creation; revoking again is idempotent and covers
        // the case where the `created` event was never delivered.
        return {
          kind: "revoke",
          orderId: null,
          mode: "chargeback",
          reason: "stripe:charge.dispute.closed:lost",
          paymentIntentId: readString(object, "payment_intent"),
          operationKey: revocationOperationKey(object, "chargeback")
        }
      }
      // Won / warning_closed: never blindly restore an entitlement (it could
      // duplicate access or resurrect a separately-refunded order). A human
      // decides, from an auditable record.
      return {
        kind: "manual_review",
        reason: `dispute_closed_${status ?? "unknown"}`,
        paymentIntentId: readString(object, "payment_intent"),
        detail: { dispute_status: status ?? null }
      }
    }

    default:
      return { kind: "ignore", reason: `unhandled_type:${type || "missing"}` }
  }
}
