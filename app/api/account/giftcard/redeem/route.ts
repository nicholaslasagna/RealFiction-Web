import { z } from "zod"

import { getAuthenticatedUser } from "@/lib/supabase/server"
import { safeJsonError } from "@/lib/security"

/**
 * Gift card redemption endpoint.
 *
 * Wire-up status: the actual redemption RPC + ledger credit path is being
 * built in a separate workstream (gift-card SKUs already exist in the
 * store; the redemption side that converts a code into a balance credit
 * is not yet shipped). This endpoint is intentionally present so:
 *
 *   1. The Account page can show a real "Redeem Gift Card" form.
 *   2. The frontend gets a structured, predictable response instead of a
 *      404 it can't reason about.
 *   3. We can flip the implementation on without re-deploying the UI.
 *
 * Until the RPC lands, the route validates input + auth, then returns
 * 503 with a friendly message. No state is changed.
 */

const bodySchema = z.object({
  code: z
    .string()
    .trim()
    .min(6, "That code looks too short.")
    .max(40, "That code looks too long.")
    .regex(/^[A-Za-z0-9_-]+$/, "Gift card codes use letters, numbers, dashes, and underscores.")
})

export async function POST(request: Request) {
  const user = await getAuthenticatedUser().catch(() => null)
  if (!user) {
    return Response.json(
      { error: "Sign in before redeeming a gift card." },
      { status: 401 }
    )
  }

  let parsed
  try {
    const body = await request.json()
    parsed = bodySchema.safeParse(body)
  } catch {
    return Response.json({ error: "Send the gift card code as JSON." }, { status: 400 })
  }

  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return Response.json({ error: issue?.message ?? "Invalid gift card code." }, { status: 400 })
  }

  // TODO: when the redemption RPC ships, replace this branch with the call
  // and return { ok: true, creditedMinor, newBalanceMinor }.
  return safeJsonError(
    "Gift card redemption is launching soon. Check back shortly.",
    503
  )
}
