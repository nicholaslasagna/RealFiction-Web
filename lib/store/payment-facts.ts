// The boundary between "a provider told us something" and "we are willing to
// grant ranks and spend a credit because of it".
//
// Two very different code paths reach fulfilment:
//
//   1. The Stripe webhook, whose authority is an HMAC signature over a payload
//      Stripe pushed to us.
//   2. Reconciliation, whose authority is a Checkout Session we PULLED from the
//      Stripe API using our own secret key.
//
// Neither may impersonate the other. Reconciliation must never be handed a
// synthesised "event" and pushed through signature-dependent webhook code — that
// would make a forged event indistinguishable from a real one at the only place
// authenticity is actually decided.
//
// Instead each path independently establishes authenticity ITS OWN way, and then
// both reduce what they learned to the same small set of normalised facts. This
// module owns that shape and the checks applied to it. It is deliberately pure:
// no network, no database, no `server-only`, so every branch is unit-testable.

/** What a caller claims a provider has told it, normalised. */
export type VerifiedPaymentFacts = {
  orderId: string
  provider: "stripe"
  sessionId: string | null
  paymentIntentId: string | null
  chargeId: string | null
  receiptUrl: string | null
  /** Money the PROVIDER collected. Never the merchandise subtotal. */
  amountPaidCents: number
  currency: string
  paymentStatus: string
  liveMode: boolean
  /**
   * How authenticity was established. Recorded so a fulfilment can always be
   * traced back to either a signed event id or a reconciliation pull.
   */
  evidence:
    | { kind: "webhook"; providerEventId: string }
    | { kind: "reconciliation"; sessionId: string; checkedAt: string }
}

/** What OUR records say the order should be. The authority for every amount. */
export type OrderExpectation = {
  orderId: string
  /** The session we persisted, if a checkout ever reached Stripe. */
  sessionId: string | null
  paymentDueCents: number
  currency: string
  liveMode: boolean
  /** Current order status; only a live order may be fulfilled. */
  status: string
}

export type FactsVerdict = { ok: true } | { ok: false; reason: string }

/** Order states a fulfilment may still act on. Anything else is terminal. */
const FULFILLABLE_STATUSES = new Set(["pending", "paid"])

/** Stripe payment states that mean the money is ours. */
const SETTLED_PAYMENT_STATUSES = new Set(["paid", "no_payment_required"])

/**
 * The single gate in front of fulfilment.
 *
 * Every check is a refusal, never a correction: nothing here rewrites an amount,
 * picks a "closest" order, or downgrades a mismatch into a warning. A caller
 * that fails this must not fulfil, must not release any financial hold, and must
 * leave a review behind — the disagreement is between Stripe's view of the money
 * and ours, and only a human can settle that.
 */
export function verifyPaymentFacts(
  facts: VerifiedPaymentFacts,
  expected: OrderExpectation
): FactsVerdict {
  if (!facts.orderId || facts.orderId !== expected.orderId) {
    return { ok: false, reason: "order_binding_mismatch" }
  }

  // A session id we never stored cannot speak for this order. When the caller
  // has no session (a store-credit-only order never creates one) this is skipped
  // — there is nothing to bind against.
  if (expected.sessionId && facts.sessionId && facts.sessionId !== expected.sessionId) {
    return { ok: false, reason: "session_binding_mismatch" }
  }

  if (facts.liveMode !== expected.liveMode) {
    return { ok: false, reason: "environment_mismatch" }
  }

  if (facts.currency.toLowerCase() !== expected.currency.toLowerCase()) {
    return { ok: false, reason: "currency_mismatch" }
  }

  if (!Number.isInteger(facts.amountPaidCents) || facts.amountPaidCents < 0) {
    return { ok: false, reason: "amount_not_representable" }
  }

  // Exact match against what WE asked Stripe to collect. Not "at least", because
  // an overpayment is as much a signal of a broken assumption as a shortfall.
  if (facts.amountPaidCents !== expected.paymentDueCents) {
    return { ok: false, reason: "amount_mismatch" }
  }

  if (!SETTLED_PAYMENT_STATUSES.has(facts.paymentStatus)) {
    return { ok: false, reason: "payment_not_settled" }
  }

  if (!FULFILLABLE_STATUSES.has(expected.status)) {
    return { ok: false, reason: `order_not_fulfillable:${expected.status}` }
  }

  return { ok: true }
}

type SessionShape = {
  id?: string
  status?: string
  payment_status?: string
  currency?: string
  amount_total?: number
  livemode?: boolean
  client_reference_id?: string
  metadata?: Record<string, string>
  payment_intent?: string | { id?: string; status?: string; latest_charge?: unknown }
}

function readPaymentIntent(session: SessionShape) {
  const intent = session.payment_intent
  if (typeof intent === "string") {
    return { id: intent, status: null as string | null, charge: null as string | null }
  }
  if (intent && typeof intent === "object") {
    const charge = intent.latest_charge
    return {
      id: typeof intent.id === "string" ? intent.id : null,
      status: typeof intent.status === "string" ? intent.status : null,
      charge:
        typeof charge === "string"
          ? charge
          : charge && typeof charge === "object" && typeof (charge as { id?: unknown }).id === "string"
            ? ((charge as { id: string }).id)
            : null
    }
  }
  return { id: null, status: null, charge: null }
}

/**
 * Normalises a PULLED Checkout Session into facts.
 *
 * Note what is NOT taken from the session: the amount that will be verified is
 * still compared against our own order downstream. This function only reports
 * what Stripe said; `verifyPaymentFacts` decides whether we believe it.
 */
export function sessionToFacts(
  session: SessionShape,
  orderId: string,
  checkedAt: string
): VerifiedPaymentFacts | null {
  if (typeof session.id !== "string" || !session.id) {
    return null
  }
  const intent = readPaymentIntent(session)

  return {
    orderId,
    provider: "stripe",
    sessionId: session.id,
    paymentIntentId: intent.id,
    chargeId: intent.charge,
    // A pulled session carries no hosted receipt URL; the charge does. Leaving
    // it null simply omits the receipt link, which the templates already handle.
    receiptUrl: null,
    amountPaidCents: typeof session.amount_total === "number" ? session.amount_total : -1,
    currency: typeof session.currency === "string" ? session.currency : "",
    paymentStatus: typeof session.payment_status === "string" ? session.payment_status : "",
    liveMode: session.livemode === true,
    evidence: { kind: "reconciliation", sessionId: session.id, checkedAt }
  }
}

/** The order this session claims to belong to, from Stripe's own copy. */
export function sessionBoundOrderId(session: SessionShape): string | null {
  return session.metadata?.order_id ?? session.client_reference_id ?? null
}
