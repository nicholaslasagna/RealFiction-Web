import "server-only"

import type { User } from "@supabase/supabase-js"

import type { CheckoutInput } from "@/lib/payments"
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
}

export async function createPendingOrder(
  input: CheckoutInput,
  lines: CheckoutLine[],
  user: User | null,
  delivery: OrderDelivery
) {
  const supabase = getSupabaseServiceRoleClient()
  const subtotalCents = lines.reduce((total, item) => total + item.lineTotalCents, 0)

  if (user) {
    await ensureProfileForUser(user)
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      user_id: user?.id ?? null,
      minecraft_username: delivery.minecraftUsername,
      minecraft_uuid: delivery.minecraftUuid,
      provider: input.provider,
      status: "pending",
      subtotal_cents: subtotalCents,
      discount_cents: 0,
      total_cents: subtotalCents,
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

export async function markOrderPaidAndFulfill(orderId: string, providerPaymentId?: string | null) {
  const supabase = getSupabaseServiceRoleClient()

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      status: "paid",
      provider_payment_id: providerPaymentId ?? null,
      paid_at: new Date().toISOString()
    })
    .eq("id", orderId)
    .in("status", ["pending", "paid"])

  if (updateError) {
    throw new Error("Could not mark order paid.")
  }

  const { data, error } = await supabase.rpc("fulfill_paid_order", {
    p_order_id: orderId
  })

  if (error) {
    throw new Error("Could not fulfill paid order.")
  }

  // Mint gift card codes for any gift-card SKUs in this order. Idempotent (one
  // card per order-item unit), so a webhook retry can't double-mint. Non-fatal:
  // the order is already fulfilled and a later re-drive will mint any missing
  // codes.
  const { error: giftError } = await supabase.rpc("issue_gift_cards_for_order", {
    p_order_id: orderId
  })
  if (giftError) {
    console.error("issue_gift_cards_error", giftError.message ?? "unknown")
  }

  return data
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
