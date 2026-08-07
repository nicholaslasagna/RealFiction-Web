import { describeError, safeJsonError } from "@/lib/security"
import { getAuthenticatedUser } from "@/lib/supabase/server"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"

const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

type StoreCreditRow = {
  balance_cents?: number | string | null
  updated_at?: string | null
}

/**
 * Returns the signed-in user's USD store-credit balance.
 *
 * Backed by public.get_store_credit_balance(p_user_id) which sums
 * public.store_credit_ledger entries (positive = redemption / refund,
 * negative = store-credit checkout spend). New accounts return
 * { balanceCents: 0, updatedAt: null }.
 *
 * Distinct from /api/account/economy which surfaces the in-game gameplay
 * balance (SMP / Factions coins). Store credit is real-money website credit
 * spendable at the storefront via gift-card redemption.
 */
export async function GET() {
  const user = await getAuthenticatedUser().catch(() => null)

  if (!user) {
    return Response.json({ error: "Sign in to view your store credit." }, { status: 401 })
  }

  try {
    const { data, error } = await callServiceRoleRpc<StoreCreditRow[] | StoreCreditRow | null>(
      "get_store_credit_balance",
      { p_user_id: user.id }
    )

    if (error) {
      console.error("account_store_credit_rpc", describeError(error))
      // 503 if the new migration hasn't landed in the target DB yet — the
      // Account UI degrades to a "store credit will appear here" empty
      // state instead of a hard error.
      const status = error.code && MISSING_SCHEMA_CODES.has(error.code) ? 503 : 500
      return safeJsonError(
        status === 503
          ? "Store credit is launching soon."
          : "Could not load your store credit.",
        status
      )
    }

    const row = Array.isArray(data) ? data[0] : data
    const rawCents = row?.balance_cents
    const cents =
      typeof rawCents === "number"
        ? rawCents
        : typeof rawCents === "string"
          ? Number(rawCents)
          : 0
    const safeCents = Number.isFinite(cents) ? Math.trunc(cents) : 0

    // How much of that balance is on hold. A separate, best-effort call: a
    // failure here must not blank out a balance the customer can see, and the
    // RPC deliberately cannot tell us WHY the hold exists.
    const hold = await callServiceRoleRpc<{ hold_cents?: number | string; restored_recently?: boolean }[] | null>(
      "recipient_credit_hold",
      { p_user_id: user.id }
    )
    const holdRow = Array.isArray(hold.data) ? hold.data[0] : null
    const holdCents = hold.error ? 0 : Math.max(0, Math.trunc(Number(holdRow?.hold_cents ?? 0)) || 0)

    // Cash-redemption review: a BOOLEAN and a STATE, nothing else. Sending an
    // eligible amount here would put a number on the account page that reads as
    // a promise to pay, and the amount is only ever computed under a lock at
    // request time anyway — a number returned now would already be stale.
    const [giftOrigin, redemption] = await Promise.all([
      callServiceRoleRpc<boolean | null>("has_gift_origin_credit", { p_user_id: user.id }),
      callServiceRoleRpc<{ state?: string }[] | null>("my_cash_redemption_status", {
        p_user_id: user.id
      })
    ])
    const redemptionRow = Array.isArray(redemption.data) ? redemption.data[0] : null

    return Response.json({
      balanceCents: safeCents,
      currency: "USD",
      updatedAt: row?.updated_at ?? null,
      holdCents,
      // Only meaningful once nothing is frozen; the UI decides which to show.
      restoredRecently: hold.error ? false : holdRow?.restored_recently === true,
      // Best-effort, like the hold: neither may blank out a visible balance.
      hasGiftOriginCredit: giftOrigin.error ? false : giftOrigin.data === true,
      cashRedemptionState: redemption.error ? null : (redemptionRow?.state ?? null)
    })
  } catch (error) {
    console.error("account_store_credit_error", describeError(error))
    return safeJsonError("Could not load your store credit.", 500)
  }
}
