// Gift-card fulfillment, downstream of the shared verified-payment gate.
//
// WHERE THIS SITS
// ===============
// The webhook and reconciliation each establish authenticity their own way
// (HMAC signature / authenticated pull), then both reduce what they learned to
// the same normalized facts and clear the same gate. Only after that does
// anything product-specific run — this module, for gift-card orders, or the
// ordinary `fulfill_paid_order_with_outbox` path for everything else.
//
// Nothing here re-decides whether the payment was real. It decides what a real
// payment for a gift card should produce.
//
// THE ORDER OF OPERATIONS MATTERS
// ===============================
// The credential is generated BEFORE the database call and passed in derived
// form only. If we instead issued the card first and attached a credential
// afterwards, a failure between the two would leave paid-for value with no way
// to claim it — value the customer owns and cannot reach.

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

import { createClaimCredential, type GiftCardCryptoEnv } from "./crypto"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

export type GiftCardIssueResult = {
  issued: boolean
  outcome: string
  giftCardId: string | null
  publicRef: string | null
}

/**
 * Issues the card for a paid gift-card order, exactly once.
 *
 * Safe to call repeatedly. The database keys issuance on the order item, so a
 * webhook replay, a reconciliation pass, and a manual retry all converge on
 * `already_issued` without minting a second card, a second credential, or a
 * second pair of emails.
 *
 * The plaintext secret exists only inside this function's frame. It is never
 * returned, never logged, and never written anywhere — the sealed copy in the
 * credential row is the only way back to it, and only the email processor holds
 * the key to open it.
 */
export async function issueGiftCardForPaidOrder(
  orderId: string,
  refs: { paymentIntentId?: string | null; chargeId?: string | null },
  env: GiftCardCryptoEnv
): Promise<GiftCardIssueResult> {
  const supabase = getSupabaseServiceRoleClient()

  // Generated in trusted server code. `createClaimCredential` throws when the
  // keys are absent or unusable, which fails the fulfilment closed — correct,
  // because a card we cannot seal is a card we cannot deliver.
  const credential = await createClaimCredential(env)

  const { data, error } = await supabase.rpc("issue_gift_card_for_order", {
    p_order_id: orderId,
    p_verifier: credential.verifier,
    p_delivery_ciphertext: credential.sealed.ciphertext,
    p_delivery_key_version: credential.sealed.keyVersion,
    p_masked_suffix: credential.sealed.maskedSuffix,
    p_payment_intent_id: refs.paymentIntentId ?? null,
    p_charge_id: refs.chargeId ?? null
  })

  if (error) {
    // THROWS so the webhook returns 500 and Stripe redelivers, and so a
    // reconciliation pass leaves the order pending for the next run. A 2xx here
    // would strand a paid order forever.
    throw new Error(`issue_gift_card_for_order failed: ${error.message ?? "unknown"}`)
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { issued?: boolean; outcome?: string; gift_card_id?: string; public_ref?: string }
    | null

  const result: GiftCardIssueResult = {
    issued: row?.issued === true,
    outcome: String(row?.outcome ?? "unknown"),
    giftCardId: row?.gift_card_id ?? null,
    publicRef: row?.public_ref ?? null
  }

  // Identity and outcome only. Never the secret, the verifier, the ciphertext,
  // the recipient address, or the message.
  console.info("gift_card_issue", {
    order_id: orderId,
    outcome: result.outcome,
    issued: result.issued,
    public_ref: result.publicRef
  })

  return result
}

/**
 * Is this order a gift-card order?
 *
 * Read from OUR product rows, never from Stripe metadata — metadata is a hint
 * the client's session influenced, and routing fulfilment on it would let a
 * crafted session pick which fulfilment path runs.
 */
export async function isGiftCardOrder(orderId: string): Promise<boolean> {
  const supabase = getSupabaseServiceRoleClient()
  const { data } = await supabase
    .from("order_items")
    .select("products(category)")
    .eq("order_id", orderId)

  const rows = (data ?? []) as Array<{ products?: { category?: string } | { category?: string }[] | null }>
  if (rows.length !== 1) {
    // A gift card is always a single-line order. Anything else is not one, and
    // the issuance RPC refuses mixed carts as well.
    return false
  }

  const product = Array.isArray(rows[0].products) ? rows[0].products[0] : rows[0].products
  return product?.category === "gift_cards"
}
