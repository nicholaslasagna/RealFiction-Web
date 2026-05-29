import { describeError, safeJsonError } from "@/lib/security"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"

const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

/**
 * Row shape returned by the `public_economy_leaderboard` RPC.
 *
 * Migration 029 added `minecraft_uuid` to the return type so the website
 * can render Minecraft skin heads through the same mc-heads.net / UUID
 * path the playtime "Top 10 - Network" board uses. Before 029 we tried
 * to enrich UUIDs in this route by cross-referencing
 * `minecraft_account_links` by username, but that failed for Bedrock
 * players whose Geyser dot-prefix username didn't match the link-flow
 * name they typed.
 *
 * Both Java UUIDs and Geyser-issued Bedrock UUIDs are valid input for
 * mc-heads.net, which is what makes this fix work for both platforms.
 */
type EconomyLeaderboardRow = {
  rank_position: number | string
  minecraft_uuid: string | null
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

    const rows = (data ?? []) as EconomyLeaderboardRow[]
    const entries = rows.map((row, index) => ({
      position: Number(row.rank_position ?? index + 1),
      name: row.minecraft_username ?? "Unknown player",
      // Pass the RPC-provided UUID straight through to the frontend.
      // Components prefer it over the username for the skin lookup.
      uuid:
        typeof row.minecraft_uuid === "string" && row.minecraft_uuid.length > 0
          ? row.minecraft_uuid
          : null,
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
