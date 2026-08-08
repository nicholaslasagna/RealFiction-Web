import { z } from "zod"

import { giftCodeHash, normalizeGiftCode } from "@/lib/gift-card"
import { safeJsonError } from "@/lib/security"
import { checkSameOrigin } from "@/lib/auth/same-origin"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"
import { getAuthenticatedUser } from "@/lib/supabase/server"

/**
 * Gift card redemption — converts a code into USD store credit on the
 * signed-in user's account.
 *
 * The plaintext code is normalized + sha256-hashed in-process and only the
 * hash is sent to redeem_gift_card(code_hash, user). The RPC is atomic and
 * idempotent (one ledger entry per card), so the same card can never be
 * redeemed twice or by two accounts. Full codes are never logged.
 */

const bodySchema = z.object({
  code: z
    .string()
    .trim()
    .min(6, "That code looks too short.")
    .max(40, "That code looks too long.")
    .regex(/^[A-Za-z0-9 _-]+$/, "Gift card codes use letters, numbers, spaces, and dashes.")
})

// PostgREST codes for "function/table/type does not exist yet" — lets the UI
// degrade gracefully if the migration hasn't landed in the target DB.
const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

type RedeemRow = {
  outcome?: string | null
  amount_cents?: number | string | null
  balance_cents?: number | string | null
}

function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

export async function POST(request: Request) {
  // Same-origin boundary for a browser-session mutation. SameSite=Lax
  // already blocks CSRF today, but that is a library default this
  // application does not control. See lib/auth/same-origin.ts.
  const sameOrigin = checkSameOrigin(request)
  if (!sameOrigin.ok) {
    console.warn("cross_origin_mutation_rejected", { route: "account/giftcard/redeem", reason: sameOrigin.reason })
    return safeJsonError("Something in your request does not look right.", 403)
  }

  const user = await getAuthenticatedUser().catch(() => null)
  if (!user) {
    return Response.json({ error: "Sign in before redeeming a gift card." }, { status: 401 })
  }

  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return Response.json({ error: "Send the gift card code as JSON." }, { status: 400 })
  }

  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid gift card code." }, { status: 400 })
  }

  // After stripping formatting there must still be a real code.
  if (normalizeGiftCode(parsed.data.code).length < 6) {
    return Response.json({ error: "That gift card code is invalid or no longer available." }, { status: 400 })
  }

  const codeHash = await giftCodeHash(parsed.data.code)

  try {
    const { data, error } = await callServiceRoleRpc<RedeemRow[] | RedeemRow | null>("redeem_gift_card", {
      p_code_hash: codeHash,
      p_user_id: user.id
    })

    if (error) {
      // Never log the code or hash. Code/message only.
      console.error("giftcard_redeem_rpc", { code: error.code ?? null })
      const status = error.code && MISSING_SCHEMA_CODES.has(error.code) ? 503 : 500
      return safeJsonError(
        status === 503 ? "Gift card redemption is launching soon. Check back shortly." : "Could not redeem that code right now.",
        status
      )
    }

    const row = Array.isArray(data) ? data[0] : data
    const outcome = row?.outcome ?? "invalid"
    const amount = Math.trunc(Number(row?.amount_cents ?? 0)) || 0

    if (outcome === "redeemed") {
      return Response.json({
        ok: true,
        message: `Gift card redeemed. ${formatUsd(amount)} has been added to your store credit.`
      })
    }

    if (outcome === "already_self") {
      return Response.json(
        { error: "You already redeemed this gift card — the credit is on your account." },
        { status: 409 }
      )
    }

    if (outcome === "already_other") {
      return Response.json({ error: "That gift card has already been redeemed." }, { status: 409 })
    }

    return Response.json(
      { error: "That gift card code is invalid or no longer available." },
      { status: 400 }
    )
  } catch (error) {
    console.error("giftcard_redeem_error", error instanceof Error ? error.message : "unknown")
    return safeJsonError("Could not redeem that code right now.", 500)
  }
}
