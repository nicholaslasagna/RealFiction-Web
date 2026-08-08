// Scheduled email queue processor.
//
// Runs from a Cloudflare Cron Trigger, NOT from a request. That means
// `process.env` is not populated here, so every binding is passed in explicitly
// — which also makes the whole processor testable with a fake client.
//
// Contract: this never throws. A mail problem must not surface anywhere near
// order or entitlement state, both of which are already final by the time a
// delivery is queued.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import {
  buildOrderConfirmationEmail,
  buildRefundConfirmationEmail,
  type OrderEmailItem
} from "./templates"
import { EMAIL_BATCH_SIZE, EMAIL_LEASE_SECONDS, sanitizeReceiptUrl } from "./queue"
import { sendProviderEmail } from "./transport"
import {
  buildGiftCardClaimedEmail,
  buildGiftCardDeliveryEmail,
  buildGiftCardFrozenRecipientEmail,
  buildGiftCardPurchaseEmail,
  buildCashRedemptionClosedEmail,
  buildCashRedemptionCompletedEmail,
  buildCashRedemptionReceivedEmail,
  buildGiftCardRefundReviewEmail,
  buildGiftCardRefundedEmail,
  buildGiftCardRefundedRecipientEmail,
  buildGiftCardRestoredRecipientEmail
} from "./gift-card-templates"
import { openClaimSecret } from "../gift-card/crypto"
import { buildCashRedemptionAdminReviewEmail } from "./cash-redemption-admin-template"

export type ProcessorEnv = {
  SUPABASE_URL?: string
  NEXT_PUBLIC_SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  // Gift-card delivery opens the sealed claim secret while rendering.
  GIFT_CARD_ENCRYPTION_KEY?: string
  GIFT_CARD_ENCRYPTION_KEY_VERSION?: string
  EMAIL_SUPPORT_ADDRESS?: string
  /**
   * Operations mailbox for cash-redemption reviews.
   *
   * Resolved HERE rather than in SQL: the destination is deployment
   * configuration, and baking it into a migration would mean a schema change to
   * redirect a mailbox. The outbox row carries an EMPTY recipient for these,
   * which is why it can only ever be delivered somewhere this resolves.
   */
  CASH_REDEMPTION_ADMIN_EMAIL?: string
  NEXT_PUBLIC_SITE_URL?: string
}

export type DeliveryRow = {
  id: string
  idempotency_key: string
  template: string
  recipient: string
  order_id: string | null
  params: Record<string, unknown> | null
  attempts: number
}

export type ProcessorResult = {
  claimed: number
  sent: number
  retried: number
  parked: number
  unconfigured: number
  /** Dispatched but unproven — awaiting a same-key retry or manual review. */
  uncertain: number
}

const DURATION_LABELS: Record<string, string> = {
  "1m": "1 Month",
  "3m": "3 Months",
  "6m": "6 Months",
  "12m": "1 Year"
}

function durationLabelFor(slug: string): string | null {
  const match = slug.match(/-(1m|3m|6m|12m)$/)
  return match ? DURATION_LABELS[match[1]] ?? null : null
}

function supabaseFor(env: ProcessorEnv): SupabaseClient | null {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  if (!url || !key) {
    return null
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/**
 * Renders one delivery. Returns null when the row can never be rendered (e.g.
 * its order vanished), which the caller treats as a permanent failure.
 */
/** Templates whose destination is configuration rather than a stored address. */
const ADMIN_TEMPLATES = new Set(["cash_redemption_admin_review"])

/**
 * The address this delivery actually goes to.
 *
 * Returns null when an admin template has no configured mailbox — the caller
 * parks the row rather than inventing a destination. An ordinary delivery keeps
 * using its stored recipient.
 */
export function resolveDestination(
  row: { template: string; recipient: string },
  env: ProcessorEnv
): string | null {
  if (!ADMIN_TEMPLATES.has(row.template)) {
    return row.recipient
  }
  const configured = env.CASH_REDEMPTION_ADMIN_EMAIL?.trim()
  return configured ? configured : null
}

async function renderDelivery(
  supabase: SupabaseClient,
  row: DeliveryRow,
  env: ProcessorEnv
): Promise<{ subject: string; text: string; html: string } | null> {
  const supportEmail = env.EMAIL_SUPPORT_ADDRESS?.trim() || "support@realfiction.live"
  const siteUrl = env.NEXT_PUBLIC_SITE_URL?.trim() || "https://realfiction.live"

  if (row.template === "cash_redemption_admin_review") {
    const params = row.params ?? {}
    return buildCashRedemptionAdminReviewEmail({
      requestId: String(params.request_id ?? ""),
      claimantUserId: String(params.claimant_user_id ?? ""),
      requestedCents: Number(params.requested_cents ?? 0),
      frozenCents: Number(params.frozen_cents ?? 0),
      state: String(params.state ?? "requested"),
      requestedAt: typeof params.requested_at === "string" ? params.requested_at : null,
      siteUrl
    })
  }

  if (row.template === "refund_confirmation") {
    const params = row.params ?? {}
    if (!row.order_id) {
      return null
    }
    return buildRefundConfirmationEmail({
      orderId: row.order_id,
      refundedCents: Number(params.refundedCents ?? 0),
      currency: String(params.currency ?? "USD"),
      isFullRefund: params.isFullRefund === true,
      affectedItemName:
        typeof params.affectedItemName === "string" ? params.affectedItemName : null,
      entitlementStatus:
        params.entitlementStatus === "revoked" || params.entitlementStatus === "under_review"
          ? params.entitlementStatus
          : "unchanged",
      supportEmail,
      siteUrl
    })
  }

  // -- Gift cards ------------------------------------------------------------

  if (row.template === "gift_card_purchase") {
    const params = row.params ?? {}
    return buildGiftCardPurchaseEmail({
      amountCents: Number(params.amount_cents ?? 0),
      currency: String(params.currency ?? "USD"),
      recipientEmail: String(params.recipient_email ?? ""),
      senderName: String(params.sender_name ?? ""),
      sentToSelf: params.sent_to_self === true,
      publicRef: String(params.public_ref ?? ""),
      supportEmail,
      siteUrl
    })
  }

  if (row.template === "gift_card_delivery") {
    const params = row.params ?? {}
    const cardId = typeof params.gift_card_id === "string" ? params.gift_card_id : null
    if (!cardId) {
      return null
    }

    // THE ONLY PLACE THE SECRET IS OPENED. The outbox row carries the card id,
    // not the secret: a queue row is retried, logged, and read by staff, and a
    // long-lived claim credential must not live in one.
    const { data: credential } = await supabase
      .from("gift_card_claim_credentials")
      .select("delivery_ciphertext")
      .eq("gift_card_id", cardId)
      .eq("state", "active")
      .maybeSingle()

    const ciphertext = credential?.delivery_ciphertext
    if (typeof ciphertext !== "string" || !ciphertext) {
      // No active credential: the card was rotated or voided between queueing
      // and sending. Returning null marks this delivery permanently unsendable
      // rather than shipping an email with a dead link.
      return null
    }

    const secret = await openClaimSecret(ciphertext, env)
    if (!secret) {
      // Wrong key, tampered ciphertext, or missing configuration. THROW rather
      // than return null: this is very likely an operator problem that a later
      // attempt can fix, so the delivery must stay retryable instead of being
      // burned. The error carries no material.
      throw new Error("gift_card_claim_secret_unavailable")
    }

    return buildGiftCardDeliveryEmail({
      amountCents: Number(params.amount_cents ?? 0),
      currency: String(params.currency ?? "USD"),
      senderName: String(params.sender_name ?? ""),
      message: typeof params.message === "string" ? params.message : null,
      // Fragment, not query string: the secret never reaches our access logs or
      // a Referer header.
      claimUrl: `${siteUrl}/gift-cards/claim#${secret}`,
      supportEmail,
      siteUrl
    })
  }

  // -- Refunds and disputes --------------------------------------------------
  //
  // Every one of these renders from the queue row's own params. None of them
  // reads the gift card back: by send time the card may be void, refrozen, or
  // spent further, and an email must describe the event it was queued for, not
  // whatever is true minutes later.
  const REFUND_TEMPLATES = {
    gift_card_refunded: buildGiftCardRefundedEmail,
    gift_card_refund_review: buildGiftCardRefundReviewEmail
  } as const

  const purchaserBuilder = REFUND_TEMPLATES[row.template as keyof typeof REFUND_TEMPLATES]
  if (purchaserBuilder) {
    const params = row.params ?? {}
    return purchaserBuilder({
      amountCents: Number(params.amount_cents ?? 0),
      currency: String(params.currency ?? "USD"),
      publicRef: String(params.public_ref ?? ""),
      supportEmail,
      siteUrl
    })
  }

  const RECIPIENT_TEMPLATES = {
    gift_card_refunded_recipient: buildGiftCardRefundedRecipientEmail,
    gift_card_frozen_recipient: buildGiftCardFrozenRecipientEmail,
    gift_card_restored_recipient: buildGiftCardRestoredRecipientEmail
  } as const

  const recipientBuilder = RECIPIENT_TEMPLATES[row.template as keyof typeof RECIPIENT_TEMPLATES]
  if (recipientBuilder) {
    const params = row.params ?? {}
    return recipientBuilder({
      amountCents: Number(params.amount_cents ?? 0),
      currency: String(params.currency ?? "USD"),
      balanceCents: Number(params.balance_cents ?? 0),
      supportEmail,
      siteUrl
    })
  }

  // -- Cash-redemption review ------------------------------------------------
  //
  // Takes NO params: there is deliberately nothing to render but the fixed
  // wording, so a queue row cannot carry an amount into an email about a
  // possible payout.
  const CASH_REDEMPTION_TEMPLATES = {
    cash_redemption_received: buildCashRedemptionReceivedEmail,
    cash_redemption_closed: buildCashRedemptionClosedEmail,
    cash_redemption_completed: buildCashRedemptionCompletedEmail
  } as const

  const cashBuilder = CASH_REDEMPTION_TEMPLATES[row.template as keyof typeof CASH_REDEMPTION_TEMPLATES]
  if (cashBuilder) {
    return cashBuilder({ supportEmail, siteUrl })
  }

  if (row.template === "gift_card_claimed") {
    const params = row.params ?? {}
    return buildGiftCardClaimedEmail({
      amountCents: Number(params.amount_cents ?? 0),
      currency: String(params.currency ?? "USD"),
      balanceCents: Number(params.balance_cents ?? 0),
      supportEmail,
      siteUrl
    })
  }

  if (row.template !== "order_confirmation" || !row.order_id) {
    return null
  }

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id,status,minecraft_username,gifted_to_minecraft_username,subtotal_cents,discount_cents,store_credit_applied_cents,payment_due_cents,total_cents,currency,created_at,stripe_receipt_url"
    )
    .eq("id", row.order_id)
    .maybeSingle()

  if (!order) {
    return null
  }

  const { data: items } = await supabase
    .from("order_items")
    .select("id,quantity,total_cents,product_snapshot")
    .eq("order_id", row.order_id)

  const itemIds = (items ?? []).map((item) => item.id as string)
  const { data: entitlements } = itemIds.length
    ? await supabase.from("entitlements").select("order_item_id,expires_at").in("order_item_id", itemIds)
    : { data: [] as Array<{ order_item_id: string; expires_at: string | null }> }

  const expiryByItem = new Map<string, string | null>()
  for (const entitlement of entitlements ?? []) {
    expiryByItem.set(
      entitlement.order_item_id as string,
      (entitlement.expires_at as string | null) ?? null
    )
  }

  const emailItems: OrderEmailItem[] = (items ?? []).map((item) => {
    const snapshot = (item.product_snapshot ?? {}) as { name?: string; slug?: string }
    const slug = snapshot.slug ?? ""
    return {
      name: snapshot.name ?? slug ?? "RealFiction item",
      quantity: Number(item.quantity ?? 1),
      durationLabel: durationLabelFor(slug),
      totalCents: Number(item.total_cents ?? 0),
      expiresAt: expiryByItem.get(item.id as string) ?? null
    }
  })

  return buildOrderConfirmationEmail({
    orderId: order.id as string,
    purchasedAt: order.created_at as string,
    deliveryUsername: (order.minecraft_username as string | null) ?? null,
    isGift: Boolean(order.gifted_to_minecraft_username),
    giftRecipient: (order.gifted_to_minecraft_username as string | null) ?? null,
    items: emailItems,
    subtotalCents: Number(order.subtotal_cents ?? 0),
    upgradeDiscountCents: Number(order.discount_cents ?? 0),
    storeCreditCents: Number(order.store_credit_applied_cents ?? 0),
    totalPaidCents: Number(order.payment_due_cents ?? order.total_cents ?? 0),
    currency: (order.currency as string) ?? "USD",
    fulfillmentStatus: (order.status as string) ?? "paid",
    supportEmail,
    siteUrl,
    // Only a provably Stripe-hosted HTTPS URL is ever rendered into an email.
    stripeReceiptUrl: sanitizeReceiptUrl(order.stripe_receipt_url as string | null)
  })
}

/**
 * Drains a bounded batch of due deliveries.
 *
 * Never throws. Returns counts for logging; the caller (a cron handler) has
 * nothing to decide based on the result.
 */
export async function processEmailQueue(
  env: ProcessorEnv,
  options: { batchSize?: number; workerId?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<ProcessorResult> {
  const result: ProcessorResult = { claimed: 0, sent: 0, retried: 0, parked: 0, unconfigured: 0, uncertain: 0 }
  const supabase = supabaseFor(env)

  if (!supabase) {
    // Without a database binding there is nothing to claim; leave the queue
    // untouched so a later run picks it up.
    console.warn("email_processor_no_database_binding")
    return result
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const workerId = options.workerId ?? `cron-${Date.now().toString(36)}`

  try {
    const { data, error } = await supabase.rpc("claim_due_email_deliveries", {
      p_limit: options.batchSize ?? EMAIL_BATCH_SIZE,
      p_lease_seconds: EMAIL_LEASE_SECONDS,
      p_worker: workerId
    })

    if (error) {
      console.error("email_claim_batch_failed")
      return result
    }

    const rows = (data ?? []) as DeliveryRow[]
    result.claimed = rows.length

    for (const row of rows) {
      // Config-missing is an operator state, not a delivery failure: park it
      // briefly WITHOUT consuming the attempt budget so the queue survives
      // until the binding is added.
      if (!env.RESEND_API_KEY?.trim()) {
        await supabase.rpc("mark_email_unconfigured", { p_delivery_id: row.id, p_retry_seconds: 300 })
        result.unconfigured++
        continue
      }

      // ADMIN templates carry an empty recipient by design; their destination
      // is configuration, not data. Resolve it before anything is rendered.
      const destination = resolveDestination(row, env)
      if (destination === null) {
        // Configured-missing is an operator state, not a delivery failure.
        // Park it WITHOUT consuming the attempt budget, exactly as a missing
        // API key is parked, so the alert survives until the binding exists.
        console.error("email_admin_destination_unconfigured", { template: row.template })
        await supabase.rpc("mark_email_unconfigured", { p_delivery_id: row.id, p_retry_seconds: 300 })
        result.unconfigured++
        continue
      }

      const content = await renderDelivery(supabase, row, env)

      if (!content) {
        await supabase.rpc("mark_email_failed", {
          p_delivery_id: row.id,
          p_error: "render_failed",
          p_retryable: false,
          p_provider_status_code: null,
          p_diagnostic_category: "render_failed",
          p_retry_after_seconds: null
        })
        result.parked++
        continue
      }

      // Opens the provider-idempotency window on the FIRST real dispatch.
      // Nothing above this line has contacted Resend, so a delivery that never
      // reached the provider never starts a deadline.
      await supabase.rpc("begin_email_provider_attempt", { p_delivery_id: row.id })

      const attempt = await sendProviderEmail(
        {
          to: destination,
          subject: content.subject,
          text: content.text,
          html: content.html,
          // The SAME deterministic key on every retry, which is what makes
          // duplicate suppression work inside the provider window.
          idempotencyKey: row.idempotency_key
        },
        {
          apiKey: env.RESEND_API_KEY,
          from: env.EMAIL_FROM?.trim() || "RealFiction <orders@realfiction.live>",
          replyTo: env.EMAIL_SUPPORT_ADDRESS?.trim() || "support@realfiction.live",
          fetchImpl,
          timeoutMs: options.timeoutMs
        }
      )

      if (attempt.kind === "accepted") {
        const { error: persistError } = await supabase.rpc("mark_email_sent", {
          p_delivery_id: row.id,
          p_provider_message_id: attempt.providerMessageId,
          p_provider_status_code: attempt.status
        })

        if (persistError) {
          // Resend accepted it but we could not record that. The delivery is
          // ambiguous from our side: retry promptly with the same key while the
          // window is open, so the provider suppresses the duplicate.
          await supabase.rpc("mark_email_uncertain", {
            p_delivery_id: row.id,
            p_category: "accepted_persist_failed"
          })
          result.uncertain++
          continue
        }

        // Log the delivery only — never the recipient, body, or provider blob.
        console.info("email_sent", { delivery_id: row.id, template: row.template })
        result.sent++
        continue
      }

      if (attempt.kind === "ambiguous") {
        await supabase.rpc("mark_email_uncertain", {
          p_delivery_id: row.id,
          p_category: attempt.category
        })
        result.uncertain++
        continue
      }

      await supabase.rpc("mark_email_failed", {
        p_delivery_id: row.id,
        p_error: attempt.error,
        p_retryable: attempt.kind === "retryable",
        p_provider_status_code: attempt.status,
        p_diagnostic_category: attempt.category,
        p_retry_after_seconds: attempt.kind === "retryable" ? attempt.retryAfterSeconds : null
      })

            if (attempt.kind === "retryable") {
        result.retried++
      } else {
        result.parked++
      }
    }
  } catch {
    console.error("email_processor_unexpected_error")
  }

  return result
}
