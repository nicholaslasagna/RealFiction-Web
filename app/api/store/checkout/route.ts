import {
  buildCartFingerprint,
  checkAttemptBinding,
  CHECKOUT_ATTEMPT_TTL_SECONDS,
  CHECKOUT_RATE_LIMIT,
  isAttemptActive,
  isSessionReusable,
  evaluateRateLimit,
  requireVerifiedBuyerEmail,
  rejectDisabledProducts,
  rejectDisabledProvider,
  rejectUnsellableProducts
} from "@/lib/checkout-guard"
import {
  createPayPalCheckout,
  createStripeCheckout,
  checkoutSchema,
  isPayPalConfigured,
  isStripeConfigured
} from "@/lib/payments"
import { safeJsonError } from "@/lib/security"
import { computeCreditApplication } from "@/lib/store-credit"
import { resolveDeliveryTarget } from "@/lib/store-delivery"
import { getAuthenticatedUser } from "@/lib/supabase/server"
import {
  attachCheckoutAttemptOrder,
  attachCheckoutSession,
  attachProviderSession,
  cancelOrder,
  closeCheckoutAttempt,
  CheckoutGuardUnavailableError,
  claimCheckoutAttempt,
  completeStoreCreditOnlyOrder,
  countRecentCheckoutAttempts,
  createPendingOrder,
  getOrderStatus,
  getStoreCreditBalanceCents,
  getVerifiedMinecraftLink,
  releaseStoreCredit,
  reserveStoreCredit,
  resolveCheckoutLines
} from "@/lib/store-server"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = checkoutSchema.safeParse(body)

  if (!parsed.success) {
    return Response.json({ error: "Something in your cart does not look right." }, { status: 400 })
  }

  // Checkout requires a signed-in account — never create a paid order we cannot
  // tie back to a buyer (also the only way to apply that buyer's store credit).
  const user = await getAuthenticatedUser().catch(() => null)
  if (!user) {
    return safeJsonError("Sign in to checkout and deliver rewards safely.", 401)
  }

  // A purchase must be tied to a mailbox the buyer has proven they control.
  // Checked before ANY order, credit reservation, or Stripe Session exists.
  const buyerEmail = requireVerifiedBuyerEmail(user)
  if (!buyerEmail.ok) {
    console.info("checkout_email_rejected", { reason: buyerEmail.code })
    return safeJsonError(buyerEmail.message, buyerEmail.status)
  }

  const isGift = parsed.data.isGift === true
  const giftRecipient = parsed.data.giftRecipient?.trim() || null

  // The buyer's linked Minecraft account is resolved on the server. A client is
  // never trusted to name the delivery target for a normal purchase.
  const link = await getVerifiedMinecraftLink(user.id).catch(() => null)

  const resolution = resolveDeliveryTarget({
    isGift,
    giftRecipient,
    submittedUsername: undefined,
    linkedUsername: link?.username ?? null
  })

  // Secret-free structured log: presence booleans + the resolved source only.
  const baseLog = {
    provider: parsed.data.provider,
    has_gift_recipient: Boolean(giftRecipient),
    has_submitted_username: false,
    has_linked_minecraft: Boolean(link?.username),
    resolved_delivery_target_source: resolution.source
  }

  if (resolution.source === "missing") {
    console.info("checkout_delivery", { ...baseLog, order_id: null, fulfillment_status: "rejected" })
    if (isGift) {
      return safeJsonError("Enter the Minecraft username that should receive this gift.", 400)
    }
    return safeJsonError("Link your Minecraft account before checkout so rewards know where to go.", 409)
  }

  // Provider gate before any work: PayPal is sandbox-only and must be refused
  // server-side even though the storefront no longer offers it.
  const providerRejection = rejectDisabledProvider(parsed.data.provider)
  if (providerRejection) {
    return safeJsonError(providerRejection.message, providerRejection.status)
  }

  let step = "init"

  try {
    // Durable, user-scoped rate limit. Counting lives in Postgres because
    // Workers isolates cannot share process-local memory.
    step = "rate_limit"
    const recentAttempts = await countRecentCheckoutAttempts(user.id, CHECKOUT_RATE_LIMIT.windowSeconds)
    const limit = evaluateRateLimit(recentAttempts)
    if (!limit.allowed) {
      console.warn("checkout_rate_limited", { ...baseLog, recent_attempts: recentAttempts })
      return Response.json(
        { error: "Too many checkout attempts. Please wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      )
    }

    step = "resolve_products"
    const lines = await resolveCheckoutLines(parsed.data)
    const merchandiseSubtotalCents = lines.reduce((total, item) => total + item.lineTotalCents, 0)

    // A zero-value cart must never reach order creation or Stripe. The schema
    // already requires at least one item, but a mispriced product could still
    // total zero — and a zero-amount Session is rejected by Stripe anyway.
    if (merchandiseSubtotalCents <= 0) {
      console.warn("checkout_zero_value_rejected", baseLog)
      return safeJsonError("Your cart is empty.", 400)
    }

    // Gift cards stay out of live checkout until their ledger passes its own
    // audit. Checked against resolved DB rows, not the client's slug strings.
    const productRejection = rejectDisabledProducts(lines.map((line) => line.product))
    if (productRejection) {
      return safeJsonError(productRejection.message, productRejection.status)
    }

    // CUTOVER GATE. Legacy timed SKUs stay `active` in the database so the
    // previously deployed site, outstanding Stripe sessions, refunds,
    // revocations, receipts and order history all keep working. This application
    // still refuses to START a new purchase of one, from the moment it is live
    // and without waiting for anyone to run an UPDATE.
    //
    // Placed here deliberately: before the order row, before the checkout
    // attempt, before either reservation, and before any Stripe request — so a
    // rejection leaves nothing behind.
    const sellableRejection = rejectUnsellableProducts(lines.map((line) => line.product))
    if (sellableRejection) {
      console.info("checkout_product_not_sold", baseLog)
      return safeJsonError(sellableRejection.message, sellableRejection.status)
    }

    // Store credit is always recomputed server-side from the ledger — the
    // client only sends whether to apply it, never an amount or balance.
    step = "compute_credit"
    const applyCredit = parsed.data.applyStoreCredit === true
    const availableCents = applyCredit ? await getStoreCreditBalanceCents(user.id) : 0
    // What we actually charge. Every price comes from the resolved product rows,
    // never from the request body.
    const subtotalCents = merchandiseSubtotalCents
    const { creditCents, dueCents } = computeCreditApplication(subtotalCents, availableCents, applyCredit)

    // A card payment is only needed when a balance remains. Gate provider config
    // only then, so a fully-credit-covered order completes even if Stripe/PayPal
    // aren't configured.
    if (dueCents > 0) {
      if (parsed.data.provider === "stripe" && !isStripeConfigured()) {
        return safeJsonError("Card payments are not ready yet.", 503)
      }
      if (parsed.data.provider === "paypal" && !isPayPalConfigured()) {
        return safeJsonError("PayPal payments are not ready yet.", 503)
      }
    }

    const effectiveProvider: "stripe" | "paypal" | "gift_card" =
      dueCents === 0 ? "gift_card" : parsed.data.provider

    // Attempt identity: the client's checkoutAttemptId, bound server-side to
    // this account, the canonical resolved cart, and the verified Minecraft
    // UUID. A unique DB constraint on (user_id, attempt_id) means concurrent
    // requests — two tabs, a double click, a retry storm — collapse onto exactly
    // one order and therefore one payable Stripe session, no matter how much
    // time passes between them.
    step = "claim_attempt"
    const cartFingerprint = buildCartFingerprint({
      userId: user.id,
      provider: parsed.data.provider,
      applyStoreCredit: applyCredit,
      isGift,
      giftRecipient,
      minecraftUuid: isGift ? null : link?.uuid ?? null,
      items: parsed.data.items
    })
    const attempt = await claimCheckoutAttempt(
      user.id,
      parsed.data.checkoutAttemptId,
      cartFingerprint,
      CHECKOUT_ATTEMPT_TTL_SECONDS
    )
    const now = Date.now()

    // An attempt id may only be used with the cart it was first bound to.
    const binding = checkAttemptBinding(attempt.storedFingerprint, cartFingerprint)
    if (!binding.ok) {
      console.warn("checkout_attempt_mismatch", { ...baseLog, order_id: attempt.existingOrderId })
      return safeJsonError(binding.message, binding.status)
    }

    // Another live attempt already owns this (account, cart) — a second tab, or
    // a reload that lost its client-side id. Reuse ITS session when still valid;
    // never mint a second payable one.
    if (attempt.status === "active_elsewhere") {
      if (
        isAttemptActive(attempt, now) &&
        isSessionReusable({ id: attempt.sessionId, url: attempt.sessionUrl, expiresAt: attempt.sessionExpiresAt }, now)
      ) {
        console.info("checkout_reused_active_session", { ...baseLog, order_id: attempt.existingOrderId })
        return Response.json({ checkoutUrl: attempt.sessionUrl, orderId: attempt.existingOrderId, reused: true })
      }
      return Response.json(
        {
          error: "A checkout for this cart is already in progress. Finish or cancel it, then try again.",
          code: "checkout_already_in_progress"
        },
        { status: 409 }
      )
    }

    // Expired or closed: terminal and immutable. The client must mint a new
    // checkoutAttemptId — we must NOT call Stripe again with this order, whose
    // idempotency key may since have been pruned.
    if (attempt.status === "closed" || !isAttemptActive(attempt, now)) {
      console.info("checkout_attempt_expired", { ...baseLog, order_id: attempt.existingOrderId })
      return Response.json(
        { error: "This checkout expired. Please start a new one.", code: "checkout_attempt_expired" },
        { status: 409 }
      )
    }

    // Resume: reuse the stored session while it is still valid.
    if (
      attempt.status === "resumed" &&
      isSessionReusable({ id: attempt.sessionId, url: attempt.sessionUrl, expiresAt: attempt.sessionExpiresAt }, now)
    ) {
      console.info("checkout_resumed_session", { ...baseLog, order_id: attempt.existingOrderId })
      return Response.json({ checkoutUrl: attempt.sessionUrl, orderId: attempt.existingOrderId, reused: true })
    }

    // The attempt is live but its session is expired/absent. If a session was
    // already issued and has expired, the attempt is spent: close it rather than
    // create a second session against the same order.
    if (attempt.sessionId && !isSessionReusable(
      { id: attempt.sessionId, url: attempt.sessionUrl, expiresAt: attempt.sessionExpiresAt }, now
    )) {
      await closeCheckoutAttempt(attempt.claimId, "session_expired")
      return Response.json(
        { error: "This checkout expired. Please start a new one.", code: "checkout_attempt_expired" },
        { status: 409 }
      )
    }

    const existingStatus = attempt.existingOrderId ? await getOrderStatus(attempt.existingOrderId) : null

    if (attempt.existingOrderId && existingStatus !== "pending") {
      await closeCheckoutAttempt(attempt.claimId, `order_${existingStatus ?? "unknown"}`)
      console.info("checkout_attempt_terminal", {
        ...baseLog,
        order_id: attempt.existingOrderId,
        fulfillment_status: `attempt_${existingStatus ?? "unknown"}`
      })
      return Response.json(
        {
          error:
            existingStatus === "paid" || existingStatus === "fulfilled"
              ? "This checkout was already completed."
              : "This checkout is no longer available. Please start a new one.",
          orderId: attempt.existingOrderId
        },
        { status: 409 }
      )
    }

    let orderId = attempt.existingOrderId
    const reusedOrder = orderId !== null

    if (!orderId) {
      step = "create_order"
      orderId = await createPendingOrder(parsed.data, lines, user, {
        minecraftUsername: link?.username ?? null,
        minecraftUuid: isGift ? null : link?.uuid ?? null,
        giftRecipient: isGift ? giftRecipient : null,
        isGift,
        source: resolution.source,
        provider: effectiveProvider,
        discountCents: 0,
        buyerEmail: buyerEmail.email,
        storeCreditCents: creditCents,
        paymentDueCents: dueCents
      })
      step = "attach_attempt"
      await attachCheckoutAttemptOrder(attempt.claimId, orderId)

    }

    const creditLog = { ...baseLog, store_credit_cents: creditCents, payment_due_cents: dueCents }

    // Full coverage: complete internally with no payment provider.
    if (dueCents === 0) {
      step = "complete_store_credit"
      const completed = await completeStoreCreditOnlyOrder(orderId, user.id)
      if (!completed) {
        await cancelOrder(orderId)
        console.error("checkout_delivery", { ...creditLog, order_id: orderId, fulfillment_status: "store_credit_failed" })
        return safeJsonError("We couldn't apply your store credit. Please refresh and try again.", 409)
      }
      // The confirmation outbox row is written INSIDE
      // complete_store_credit_only_order, in the same transaction as the credit
      // spend and fulfilment. There is no separate enqueue to lose: if the
      // outbox insert had failed, `completed` would be false and nothing above
      // would have committed. No Stripe receipt is queued — there was no charge.

      console.info("checkout_delivery", { ...creditLog, order_id: orderId, fulfillment_status: "completed_store_credit" })
      return Response.json({ completed: true, orderId })
    }

    // Partial coverage: reserve the applied credit before charging the rest, so
    // it can't be double-spent while payment is pending. A reused (still
    // pending) order already holds its reservation — reserving again would
    // double-debit the ledger.
    if (creditCents > 0 && !reusedOrder) {
      step = "reserve_credit"
      const reserved = await reserveStoreCredit(orderId, user.id, creditCents)
      if (!reserved) {
        await cancelOrder(orderId)
        console.error("checkout_delivery", { ...creditLog, order_id: orderId, fulfillment_status: "credit_reserve_failed" })
        return safeJsonError("Your store credit balance changed. Please review your cart and try again.", 409)
      }
    }

    step = parsed.data.provider === "stripe" ? "stripe_session" : "paypal_order"
    const order = {
      id: orderId,
      provider: parsed.data.provider,
      // Authenticated account email -> Stripe `receipt_email`, so Stripe issues
      // its own payment receipt on a successful charge (and only then).
      buyerEmail: buyerEmail.email,
      minecraftUsername: resolution.username,
      giftRecipient: isGift ? giftRecipient : null,
      isGift,
      storeCreditAppliedCents: creditCents,
      paymentDueCents: dueCents,
      discountCents: merchandiseSubtotalCents - subtotalCents
    }

    const result =
      parsed.data.provider === "stripe"
        ? await createStripeCheckout(order, lines)
        : await createPayPalCheckout(order, lines)

    if (!result.checkoutUrl) {
      if (creditCents > 0) {
        await releaseStoreCredit(orderId)
      }
      await cancelOrder(orderId)
      console.error("checkout_delivery", { ...creditLog, order_id: orderId, fulfillment_status: "provider_no_url" })
      return safeJsonError("We could not start payment yet. Please try again.", 502)
    }

    step = "attach_session"
    await attachProviderSession(orderId, result.providerSessionId)

    // Compare-and-set onto the attempt. If a DIFFERENT session is already bound
    // (an ambiguous first response that actually succeeded, then a retry that
    // created another), refuse to swap: the bound session stays authoritative
    // and the customer is sent there, so only one session is ever payable.
    if (result.providerSessionId) {
      const attached = await attachCheckoutSession({
        claimId: attempt.claimId,
        sessionId: result.providerSessionId,
        sessionUrl: result.checkoutUrl,
        sessionExpiresAt:
          "sessionExpiresAt" in result && typeof result.sessionExpiresAt === "string"
            ? result.sessionExpiresAt
            : null
      })

      if (!attached) {
        console.warn("checkout_session_attach_conflict", { ...creditLog, order_id: orderId })
        const current = await claimCheckoutAttempt(
          user.id,
          parsed.data.checkoutAttemptId,
          cartFingerprint,
          CHECKOUT_ATTEMPT_TTL_SECONDS
        )
        if (current.sessionUrl) {
          return Response.json({ checkoutUrl: current.sessionUrl, orderId, reused: true })
        }
        return safeJsonError("We could not start payment yet. Please try again.", 409)
      }
    }

    console.info("checkout_delivery", { ...creditLog, order_id: orderId, fulfillment_status: "pending_payment" })

    return Response.json({ checkoutUrl: result.checkoutUrl, orderId })
  } catch (error) {
    // Fail CLOSED. A guard that could not be evaluated means duplicate-payment
    // protection is not in force, so we refuse rather than degrade. By
    // construction every guard runs BEFORE order creation, credit reservation,
    // and any Stripe call, so a 503 here means none of those happened.
    if (error instanceof CheckoutGuardUnavailableError) {
      console.error("checkout_guard_unavailable", { ...baseLog, step, guard: error.guard })
      return Response.json(
        { error: "Checkout is temporarily unavailable. Please try again in a moment." },
        { status: 503, headers: { "Retry-After": "30" } }
      )
    }

    console.error("checkout_failed", {
      ...baseLog,
      step,
      reason: error instanceof Error ? error.message : "unknown_error"
    })
    return safeJsonError("Payments are unavailable right now.", 500)
  }
}
