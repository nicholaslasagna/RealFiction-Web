import { describeError, safeJsonError } from "@/lib/security"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"

const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

type EconomyLeaderboardRow = {
  rank_position: number | string
  minecraft_username: string | null
  balance_minor: number | string
}

export async function GET() {
  try {
    const { data, error } = await callServiceRoleRpc<EconomyLeaderboardRow[]>(
      "public_economy_leaderboard",
      {
        p_currency_key: "realfiction_main",
        p_limit: 10
      }
    )

    if (error) {
      console.error("public_economy_leaderboard_rpc", describeError(error))
      const status = error.code && MISSING_SCHEMA_CODES.has(error.code) ? 503 : 500
      return safeJsonError("Economy leaderboard could not be loaded.", status)
    }

    const entries = ((data ?? []) as EconomyLeaderboardRow[]).map((row, index) => ({
      position: Number(row.rank_position ?? index + 1),
      name: row.minecraft_username ?? "Unknown player",
      balanceMinor: String(row.balance_minor ?? 0)
    }))

    return new Response(
      JSON.stringify({
        currencyKey: "realfiction_main",
        scale: 100,
        entries
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120"
        }
      }
    )
  } catch (error) {
    console.error("public_economy_leaderboard_error", describeError(error))
    return safeJsonError("Economy leaderboard could not be loaded.", 500)
  }
}
