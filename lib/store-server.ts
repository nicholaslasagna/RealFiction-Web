// NO `server-only` MARKER, DELIBERATELY.
//
// This module is reachable from the Cloudflare Worker entry (worker/index.ts)
// as well as from Next server code. Wrangler bundles that entry WITHOUT the
// `react-server` export condition, so `server-only` resolves to its throwing
// `index.js` rather than the empty stub Next resolves it to — and the Worker
// then fails deploy validation with Cloudflare error 10021 before it ever runs.
//
// The boundary this marker used to provide is enforced instead by
// lib/server-boundary.test.ts, which fails if any `"use client"` module can
// reach a privileged module. That check covers the Worker graph too, which the
// marker never could.

import type { User } from "@supabase/supabase-js"

import type { CheckoutInput } from "@/lib/payments"
import type { OrderExpectation } from "@/lib/store/payment-facts"
import { sanitizeReceiptUrl } from "@/lib/email/queue"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

const SAFE_PRODUCT_CATEGORIES = new Set([
  "supporter",
  "cosmetics",
  "pets",
  "particles",
  "identity",
  "lobby",
  "gift_cards"
])

export type CheckoutProduct = {
  id: string
  slug: string
  category: string
  name: string
  description: string
  price_cents: number
  currency: string
  fulfillment_type: "permanent" | "subscription" | "consumable"
  duration_days: number | null
  metadata: Record<string, unknown>
  active: boolean
}

export type CheckoutLine = {
  product: CheckoutProduct
  quantity: number
  lineTotalCents: number
}

export function assertSafeProduct(product: CheckoutProduct) {
  if (!product.id || !product.slug || !product.active) {
    throw new Error("Product is not active.")
  }

  if (!SAFE_PRODUCT_CATEGORIES.has(product.category)) {
    throw new Error("Product category is not allowed.")
  }

  if (product.price_cents < 0) {
    throw new Error("Product price is invalid.")
  }

  if (product.fulfillment_type === "subscription" && !product.duration_days) {
    throw new Error("Timed product duration is missing.")
  }

  const metadataText = JSON.stringify(product.metadata ?? {})

  if (/(damage|combat|weapon|kit|economy_multiplier|claim_bonus|crate_power|pay_to_win)/i.test(metadataText)) {
    throw new Error("Product metadata contains a blocked gameplay advantage signal.")
  }
}

export async function resolveCheckoutLines(input: CheckoutInput) {
  const supabase = getSupabaseServiceRoleClient()
  const slugs = [...new Set(input.items.map((item) => item.productId))]

  const { data, error } = await supabase
    .from("products")
    .select("id, slug, category, name, description, price_cents, currency, fulfillment_type, duration_days, metadata, active")
    .in("slug", slugs)
    .eq("active", true)

  if (error) {
    throw new Error("Could not load checkout products.")
  }

  const products = new Map((data ?? []).map((product) => [product.slug as string, product as CheckoutProduct]))

  return input.items.map((item) => {
    const product = products.get(item.productId)

    if (!product) {
      throw new Error("Unknown or inactive product.")
    }

    assertSafeProduct(product)

    if (product.fulfillment_type !== "consumable" && item.quantity !== 1) {
      throw new Error("Non-consumable products must be purchased one at a time.")
    }

    if (
      product.fulfillment_type === "subscription" &&
      (!product.duration_days || product.duration_days < 1 || product.duration_days > 366)
    ) {
      throw new Error("Subscription duration is invalid.")
    }

    return {
      product,
      quantity: item.quantity,
      lineTotalCents: product.price_cents * item.quantity
    }
  })
}

export async function ensureProfileForUser(user: User) {
  const supabase = getSupabaseServiceRoleClient()

  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email ?? null
    },
    { onConflict: "id" }
  )

  if (error) {
    throw new Error("Could not ensure account profile.")
  }
}

/**
 * Looks up the buyer's verified Minecraft link (service-role, scoped to the
 * user) so a normal checkout can deliver to their linked account without making
 * them retype their username. Returns null when no verified link exists.
 */
export async function getVerifiedMinecraftLink(userId: string) {
  const supabase = getSupabaseServiceRoleClient()
  const { data } = await supabase
    .from("minecraft_account_links")
    .select("minecraft_username, minecraft_uuid")
    .eq("user_id", userId)
    .eq("status", "verified")
    .order("verified_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data || !data.minecraft_username) {
    return null
  }

  return {
    username: data.minecraft_username as string,
    uuid: (data.minecraft_uuid as string | null) ?? null
  }
}

export type OrderDelivery = {
  // Purchaser's linked Minecraft username — the delivery target for a normal
  // purchase, and the purchaser-of-record for a gift. The checkout route rejects
  // non-gift orders that reach here without one.
  minecraftUsername: string | null
  // Buyer UUID for direct delivery on normal purchases; null for gifts so the
  // reward resolves the recipient by username instead of the buyer's UUID.
  minecraftUuid: string | null
  // Gift recipient username (gift orders only); fulfillment delivers here.
  giftRecipient: string | null
  isGift: boolean
  source: string
  // Effective order provider — 'gift_card' for a full-store-credit order with no
  // card payment, otherwise the requested 'stripe'/'paypal'.
  provider: "stripe" | "paypal" | "gift_card"
  // Store credit applied at creation + the remaining amount to charge (cents).
  storeCreditCents: number
  paymentDueCents: number
  /**
   * Server-computed discount (cents). The order's total is the merchandise
   * subtotal MINUS this — never recomputed from line prices.
   */
  discountCents: number
  /**
   * The buyer's VERIFIED email, snapshotted at checkout. Fulfilment and refund
   * mail always use this, never the profile's current address — a later email
   * change must not redirect an existing order's correspondence.
   */
  buyerEmail: string
}

export async function createPendingOrder(
  input: CheckoutInput,
  lines: CheckoutLine[],
  user: User | null,
  delivery: OrderDelivery
) {
  const supabase = getSupabaseServiceRoleClient()
  const subtotalCents = lines.reduce((total, item) => total + item.lineTotalCents, 0)
  const discountCents = Math.max(0, Math.min(delivery.discountCents ?? 0, subtotalCents))
  // What we actually bill. Clamped so a discount can never exceed the cart or
  // produce a negative total.
  const totalCents = subtotalCents - discountCents

  if (user) {
    await ensureProfileForUser(user)
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      user_id: user?.id ?? null,
      buyer_email: delivery.buyerEmail,
      minecraft_username: delivery.minecraftUsername,
      minecraft_uuid: delivery.minecraftUuid,
      provider: delivery.provider,
      status: "pending",
      subtotal_cents: subtotalCents,
      discount_cents: discountCents,
      total_cents: totalCents,
      store_credit_applied_cents: delivery.storeCreditCents,
      payment_due_cents: delivery.paymentDueCents,
      currency: "USD",
      gifted_to_minecraft_username: delivery.giftRecipient,
      metadata: {
        checkout_version: 2,
        is_gift: delivery.isGift,
        delivery_source: delivery.source,
        product_slugs: lines.map((line) => line.product.slug)
      }
    })
    .select("id")
    .single()

  if (orderError || !order) {
    throw new Error("Could not create pending order.")
  }

  const { error: itemsError } = await supabase.from("order_items").insert(
    lines.map((line) => ({
      order_id: order.id,
      product_id: line.product.id,
      product_snapshot: {
        id: line.product.id,
        slug: line.product.slug,
        name: line.product.name,
        category: line.product.category,
        description: line.product.description,
        price_cents: line.product.price_cents,
        currency: line.product.currency,
        fulfillment_type: line.product.fulfillment_type,
        duration_days: line.product.duration_days,
        metadata: line.product.metadata
      },
      quantity: line.quantity,
      unit_price_cents: line.product.price_cents,
      total_cents: line.lineTotalCents
    }))
  )

  if (itemsError) {
    await supabase.from("orders").update({ status: "cancelled" }).eq("id", order.id)
    throw new Error("Could not create order items.")
  }

  return order.id as string
}

export async function attachProviderSession(orderId: string, providerSessionId: string | null) {
  if (!providerSessionId) {
    return
  }

  const supabase = getSupabaseServiceRoleClient()
  const { error } = await supabase
    .from("orders")
    .update({ provider_session_id: providerSessionId })
    .eq("id", orderId)

  if (error) {
    throw new Error("Could not attach checkout session.")
  }
}

export async function cancelOrder(orderId: string) {
  const supabase = getSupabaseServiceRoleClient()
  await supabase.from("orders").update({ status: "cancelled" }).eq("id", orderId).eq("status", "pending")
}

/**
 * Atomically fulfils a paid Stripe order AND writes its confirmation outbox row.
 *
 * THROWS on failure — deliberately. The webhook must return a retryable response
 * so Stripe redelivers, rather than a 2xx that silently dropped the outbox
 * operation. No provider HTTP call happens inside the transaction.
 */
export async function fulfillPaidOrderWithOutbox(
  orderId: string,
  refs: { paymentIntentId?: string | null; chargeId?: string | null; receiptUrl?: string | null } = {}
): Promise<{ alreadyFulfilled: boolean; emailQueued: boolean }> {
  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase.rpc("fulfill_paid_order_with_outbox", {
    p_order_id: orderId,
    p_payment_intent_id: refs.paymentIntentId ?? null,
    p_charge_id: refs.chargeId ?? null,
    // Only a provably Stripe-hosted HTTPS URL is ever stored.
    p_receipt_url: sanitizeReceiptUrl(refs.receiptUrl)
  })

  if (error) {
    throw new Error(`fulfill_paid_order_with_outbox failed: ${error.message ?? "unknown"}`)
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { already_fulfilled?: boolean; email_queued?: boolean }
    | null

  return {
    alreadyFulfilled: row?.already_fulfilled === true,
    emailQueued: row?.email_queued === true
  }
}

/**
 * Atomically claims the revocation, revokes the order, and writes the refund
 * confirmation outbox row. Throws so the webhook can ask Stripe to redeliver.
 */
export async function revokeOrderWithRefundOutbox(input: {
  orderId: string
  operationKey: string
  mode: "refund" | "chargeback"
  reason: string
  refundId?: string | null
  refundedCents?: number
  currency?: string
  isFullRefund?: boolean
  entitlementStatus?: "revoked" | "unchanged" | "under_review"
  affectedItemName?: string | null
}): Promise<{ claimed: boolean; emailQueued: boolean }> {
  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase.rpc("revoke_order_with_refund_outbox", {
    p_order_id: input.orderId,
    p_operation_key: input.operationKey,
    p_mode: input.mode,
    p_reason: input.reason,
    p_refund_id: input.refundId ?? null,
    p_refunded_cents: input.refundedCents ?? 0,
    p_currency: input.currency ?? "USD",
    p_is_full_refund: input.isFullRefund === true,
    p_entitlement_status: input.entitlementStatus ?? "revoked",
    p_affected_item_name: input.affectedItemName ?? null
  })

  if (error) {
    throw new Error(`revoke_order_with_refund_outbox failed: ${error.message ?? "unknown"}`)
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { claimed?: boolean; email_queued?: boolean }
    | null

  return { claimed: row?.claimed === true, emailQueued: row?.email_queued === true }
}

/** Partial refunds notify without revoking. Idempotent on the refund id. */
export async function enqueuePartialRefundOutbox(input: {
  orderId: string
  refundId: string
  refundedCents: number
  currency: string
  affectedItemName?: string | null
}): Promise<void> {
  const supabase = getSupabaseServiceRoleClient()
  const { error } = await supabase.rpc("enqueue_partial_refund_outbox", {
    p_order_id: input.orderId,
    p_refund_id: input.refundId,
    p_refunded_cents: input.refundedCents,
    p_currency: input.currency,
    p_affected_item_name: input.affectedItemName ?? null
  })
  if (error) {
    throw new Error(`enqueue_partial_refund_outbox failed: ${error.message ?? "unknown"}`)
  }
}

export async function getStoreCreditBalanceCents(userId: string): Promise<number> {
  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase.rpc("get_store_credit_balance", { p_user_id: userId })
  if (error) {
    return 0
  }
  const row = Array.isArray(data) ? data[0] : data
  const cents = Number((row as { balance_cents?: number | string } | null)?.balance_cents ?? 0)
  return Number.isFinite(cents) ? Math.max(0, Math.trunc(cents)) : 0
}

/** Reserve credit for a partial-credit order before redirecting to a provider. */
export async function reserveStoreCredit(orderId: string, userId: string, amountCents: number): Promise<boolean> {
  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase.rpc("reserve_store_credit_for_order", {
    p_order_id: orderId,
    p_user_id: userId,
    p_amount_cents: amountCents
  })
  return !error && data === true
}

/** Release a reserved credit hold (checkout cancelled/expired/failed). */
export async function releaseStoreCredit(orderId: string): Promise<void> {
  const supabase = getSupabaseServiceRoleClient()
  const { error } = await supabase.rpc("release_store_credit_for_order", { p_order_id: orderId })
  if (error) {
    console.error("release_store_credit_error", error.message ?? "unknown")
  }
}

/** Complete a full-store-credit order with no payment provider (atomic). */
export async function completeStoreCreditOnlyOrder(orderId: string, userId: string): Promise<boolean> {
  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase.rpc("complete_store_credit_only_order", {
    p_order_id: orderId,
    p_user_id: userId
  })
  return !error && data === true
}

export async function findOrderIdByPaymentId(provider: "stripe" | "paypal", paymentId: string) {
  const supabase = getSupabaseServiceRoleClient()
  const { data } = await supabase
    .from("orders")
    .select("id")
    .eq("provider", provider)
    .eq("provider_payment_id", paymentId)
    .maybeSingle()

  return (data?.id as string | undefined) ?? null
}

export async function revokeOrder(orderId: string, mode: "refund" | "chargeback", reason?: string) {
  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase.rpc("revoke_order", {
    p_order_id: orderId,
    p_mode: mode,
    p_reason: reason ?? null
  })

  if (error) {
    throw new Error("Could not revoke order.")
  }

  return data
}

export async function persistWebhookEvent(provider: "stripe" | "paypal", providerEventId: string, eventType: string, payload: unknown) {
  const supabase = getSupabaseServiceRoleClient()
  const { error } = await supabase.from("webhook_events").insert({
    provider,
    provider_event_id: providerEventId,
    event_type: eventType,
    payload
  })

  if (!error) {
    return { duplicate: false, alreadyProcessed: false }
  }

  if (error.code === "23505") {
    // The event was already received. Distinguish a fully-processed event from
    // one persisted by a prior attempt that failed before fulfillment, so the
    // provider's retry can safely re-drive the idempotent fulfillment instead
    // of being silently dropped as a duplicate.
    const { data: existing } = await supabase
      .from("webhook_events")
      .select("processed_at")
      .eq("provider", provider)
      .eq("provider_event_id", providerEventId)
      .maybeSingle()

    return { duplicate: true, alreadyProcessed: Boolean(existing?.processed_at) }
  }

  throw new Error("Could not persist webhook event.")
}

export async function markWebhookEventProcessed(provider: "stripe" | "paypal", providerEventId: string) {
  const supabase = getSupabaseServiceRoleClient()
  await supabase
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("provider", provider)
    .eq("provider_event_id", providerEventId)
}

// -- Checkout attempt idempotency + rate limiting ----------------------------

export type CheckoutAttemptClaim = {
  claimId: string
  existingOrderId: string | null
  storedFingerprint: string | null
  /** 'new' | 'resumed' | 'active_elsewhere' | 'closed' */
  status: string
  attemptExpiresAt: string | null
  sessionId: string | null
  sessionUrl: string | null
  sessionExpiresAt: string | null
}

/**
 * Thrown when a guard that protects against duplicate payment cannot be
 * evaluated. Callers MUST fail closed (503) — never proceed to create an order,
 * reserve credit, or call Stripe.
 */
export class CheckoutGuardUnavailableError extends Error {
  readonly guard: string

  constructor(guard: string, cause?: string) {
    super(`Checkout guard unavailable: ${guard}${cause ? ` (${cause})` : ""}`)
    this.name = "CheckoutGuardUnavailableError"
    this.guard = guard
  }
}

/**
 * Claims (or re-reads) the attempt slot for this account + attempt id.
 *
 * FAILS CLOSED. Duplicate-payment protection must never silently degrade: if
 * this cannot be evaluated we refuse the checkout rather than risk two orders
 * and two payable Stripe sessions for one intent.
 */
export async function claimCheckoutAttempt(
  userId: string,
  attemptId: string,
  cartFingerprint: string,
  ttlSeconds: number
): Promise<CheckoutAttemptClaim> {
  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase.rpc("claim_checkout_attempt", {
    p_user_id: userId,
    p_attempt_id: attemptId,
    p_cart_fingerprint: cartFingerprint,
    p_ttl_seconds: ttlSeconds
  })

  if (error) {
    throw new CheckoutGuardUnavailableError("claim_checkout_attempt", error.message ?? "unknown")
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        claim_id?: string
        existing_order_id?: string | null
        stored_fingerprint?: string | null
        status?: string
        attempt_expires_at?: string | null
        stripe_session_id?: string | null
        stripe_session_url?: string | null
        stripe_session_expires_at?: string | null
      }
    | null

  if (!row?.claim_id || !row.status) {
    throw new CheckoutGuardUnavailableError("claim_checkout_attempt", "empty result")
  }

  return {
    claimId: row.claim_id,
    existingOrderId: row.existing_order_id ?? null,
    storedFingerprint: row.stored_fingerprint ?? null,
    status: row.status,
    attemptExpiresAt: row.attempt_expires_at ?? null,
    sessionId: row.stripe_session_id ?? null,
    sessionUrl: row.stripe_session_url ?? null,
    sessionExpiresAt: row.stripe_session_expires_at ?? null
  }
}

/** Closes an attempt so its cart lock is released and it can never be revived. */
export async function closeCheckoutAttempt(claimId: string, reason: string): Promise<void> {
  const supabase = getSupabaseServiceRoleClient()
  const { error } = await supabase.rpc("close_checkout_attempt", {
    p_claim_id: claimId,
    p_reason: reason
  })
  if (error) {
    console.error("close_checkout_attempt_error", error.message ?? "unknown")
  }
}

/**
 * Compare-and-set Stripe session attachment. Fails closed: a different session
 * already bound to this attempt is never replaced, because the displaced one
 * would remain payable and untracked.
 */
export async function attachCheckoutSession(input: {
  claimId: string
  sessionId: string
  sessionUrl: string | null
  sessionExpiresAt: string | null
}): Promise<boolean> {
  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase.rpc("attach_checkout_session", {
    p_claim_id: input.claimId,
    p_session_id: input.sessionId,
    p_session_url: input.sessionUrl,
    p_session_expires_at: input.sessionExpiresAt
  })
  if (error) {
    throw new CheckoutGuardUnavailableError("attach_checkout_session", error.message ?? "unknown")
  }
  return data === true
}

/** Links the created order to its attempt. Fails closed: a lost link would let a retry create a second order. */
export async function attachCheckoutAttemptOrder(claimId: string, orderId: string) {
  const supabase = getSupabaseServiceRoleClient()
  const { error } = await supabase.rpc("attach_checkout_attempt_order", {
    p_attempt_id: claimId,
    p_order_id: orderId
  })
  if (error) {
    throw new CheckoutGuardUnavailableError("attach_checkout_attempt_order", error.message ?? "unknown")
  }
}

/**
 * Durable (DB-backed) attempt count for rate limiting — Workers-safe.
 * FAILS CLOSED: an unreadable counter must not become an unlimited counter.
 */
export async function countRecentCheckoutAttempts(userId: string, windowSeconds: number): Promise<number> {
  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase.rpc("count_recent_checkout_attempts", {
    p_user_id: userId,
    p_window_seconds: windowSeconds
  })
  if (error) {
    throw new CheckoutGuardUnavailableError("count_recent_checkout_attempts", error.message ?? "unknown")
  }
  const count = Number(Array.isArray(data) ? data[0] : data)
  if (!Number.isFinite(count)) {
    throw new CheckoutGuardUnavailableError("count_recent_checkout_attempts", "non-numeric result")
  }
  return Math.max(0, Math.trunc(count))
}

export async function getOrderStatus(orderId: string): Promise<string | null> {
  const supabase = getSupabaseServiceRoleClient()
  const { data } = await supabase.from("orders").select("status").eq("id", orderId).maybeSingle()
  return (data?.status as string | undefined) ?? null
}

// -- Refund / dispute support ------------------------------------------------

export type OrderPaymentContext = {
  orderId: string
  status: string
  /** What Stripe actually charged (store credit excluded). */
  paidCents: number | null
  /** The order's currency. A refund in another currency is not this order's. */
  currency: string
  items: { id: string; totalCents: number }[]
}

/**
 * Trusted server-side view of what we charged for an order, used to decide
 * whether a refund is full or partial. Never derived from event metadata.
 */
export async function getOrderPaymentContext(orderId: string): Promise<OrderPaymentContext | null> {
  const supabase = getSupabaseServiceRoleClient()
  const { data: order } = await supabase
    .from("orders")
    .select("id, status, payment_due_cents, total_cents, currency")
    .eq("id", orderId)
    .maybeSingle()

  if (!order) {
    return null
  }

  const { data: items } = await supabase.from("order_items").select("id, total_cents").eq("order_id", orderId)

  const due = Number(order.payment_due_cents ?? order.total_cents)

  return {
    orderId: order.id as string,
    status: order.status as string,
    paidCents: Number.isFinite(due) ? due : null,
    currency: String(order.currency ?? "USD"),
    items: (items ?? []).map((item) => ({
      id: item.id as string,
      totalCents: Number(item.total_cents ?? 0)
    }))
  }
}

/**
 * OUR record of what an order should be, for the shared fulfilment gate.
 *
 * Every expected amount comes from here. A provider payload is only ever
 * compared against this — never the other way round.
 */
export async function getOrderExpectation(orderId: string): Promise<OrderExpectation | null> {
  const supabase = getSupabaseServiceRoleClient()
  const { data } = await supabase
    .from("orders")
    .select("id,status,payment_due_cents,total_cents,currency,provider_session_id")
    .eq("id", orderId)
    .maybeSingle()

  if (!data) {
    return null
  }

  const due = Number(data.payment_due_cents ?? data.total_cents)
  if (!Number.isFinite(due)) {
    return null
  }

  return {
    orderId: data.id as string,
    sessionId: (data.provider_session_id as string | null) ?? null,
    paymentDueCents: due,
    currency: String(data.currency ?? "USD"),
    liveMode: (process.env.STRIPE_ENVIRONMENT ?? "").trim().toLowerCase() === "live",
    status: String(data.status)
  }
}

/** Append-only, idempotent audit record for refund/dispute outcomes. */
export async function recordPaymentReview(input: {
  providerEventId: string
  eventType: string
  reason: string
  orderId?: string | null
  paymentIntentId?: string | null
  detail?: Record<string, unknown>
}) {
  const supabase = getSupabaseServiceRoleClient()
  const { error } = await supabase.rpc("record_payment_review", {
    p_provider_event_id: input.providerEventId,
    p_event_type: input.eventType,
    p_reason: input.reason,
    p_order_id: input.orderId ?? null,
    p_payment_intent_id: input.paymentIntentId ?? null,
    p_detail: input.detail ?? {},
    p_provider: "stripe"
  })
  if (error) {
    console.error("record_payment_review_error", error.message ?? "unknown")
  }
}

/**
 * Claims a revocation keyed on the Stripe REFUND/DISPUTE object id.
 * Returns true only for the first caller — later events for the same refund
 * (refund.created then refund.updated, or any replay) return false.
 */
export async function claimPaymentRevocation(input: {
  operationKey: string
  orderId: string
  mode: "refund" | "chargeback"
  reason?: string | null
}): Promise<boolean> {
  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase.rpc("claim_payment_revocation", {
    p_operation_key: input.operationKey,
    p_order_id: input.orderId,
    p_mode: input.mode,
    p_reason: input.reason ?? null
  })
  if (error) {
    // Fail closed: if we cannot prove this revocation is new, do not revoke.
    // A missed revocation is recoverable by a human; a double revocation
    // corrupts entitlement state.
    console.error("claim_payment_revocation_error", error.message ?? "unknown")
    return false
  }
  return data === true
}

/** Cancels an unpaid pending order (payment failed / session expired). */
export async function markOrderUnpaidClosed(orderId: string, reason: string): Promise<boolean> {
  const supabase = getSupabaseServiceRoleClient()
  const { data, error } = await supabase.rpc("mark_order_unpaid_closed", {
    p_order_id: orderId,
    p_reason: reason
  })
  if (error) {
    console.error("mark_order_unpaid_closed_error", error.message ?? "unknown")
    return false
  }
  return data === true
}
