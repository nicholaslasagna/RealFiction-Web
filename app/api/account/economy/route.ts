import { describeError, safeJsonError } from "@/lib/security"
import { createSupabaseServerClient, getAuthenticatedUser } from "@/lib/supabase/server"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"

const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

type BalanceResult = {
  currency_key?: string
  minecraft_uuid?: string
  minecraft_username?: string | null
  balance_minor?: number | string
  updated_at?: string | null
}

export async function GET() {
  const user = await getAuthenticatedUser().catch(() => null)

  if (!user) {
    return Response.json({ error: "Sign in to view your balance." }, { status: 401 })
  }

  try {
    const supabase = await createSupabaseServerClient()
    const { data: link, error: linkError } = await supabase
      .from("minecraft_account_links")
      .select("minecraft_uuid,minecraft_username")
      .eq("user_id", user.id)
      .eq("status", "verified")
      .not("minecraft_uuid", "is", null)
      .order("verified_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()

    if (linkError) {
      console.error("account_economy_link_error", describeError(linkError))
      return safeJsonError("Could not load your Minecraft account.", 500)
    }

    if (!link?.minecraft_uuid) {
      return Response.json({
        linked: false,
        currencyKey: "realfiction_main",
        minecraftUuid: null,
        minecraftUsername: null,
        balanceMinor: "0",
        scale: 100,
        updatedAt: null
      })
    }

    const { data, error } = await callServiceRoleRpc<BalanceResult[] | BalanceResult | null>("get_economy_balance", {
      p_currency_key: "realfiction_main",
      p_minecraft_uuid: link.minecraft_uuid
    })

    if (error) {
      console.error("account_economy_balance_rpc", describeError(error))
      const status = error.code && MISSING_SCHEMA_CODES.has(error.code) ? 503 : 500
      return safeJsonError(status === 503 ? "Balance is not ready yet." : "Could not load your balance.", status)
    }

    const row = Array.isArray(data) ? data[0] : data

    return Response.json({
      linked: true,
      currencyKey: row?.currency_key ?? "realfiction_main",
      minecraftUuid: row?.minecraft_uuid ?? link.minecraft_uuid,
      minecraftUsername: row?.minecraft_username ?? link.minecraft_username,
      balanceMinor: String(row?.balance_minor ?? 0),
      scale: 100,
      updatedAt: row?.updated_at ?? null
    })
  } catch (error) {
    console.error("account_economy_error", describeError(error))
    return safeJsonError("Could not load your balance.", 500)
  }
}
