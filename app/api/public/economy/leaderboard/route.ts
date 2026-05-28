import { describeError, safeJsonError } from "@/lib/security"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

type EconomyLeaderboardRow = {
  rank_position: number | string
  minecraft_username: string | null
  balance_minor: number | string
}

type AccountLinkRow = {
  minecraft_username: string | null
  minecraft_uuid: string | null
}

/**
 * Public economy leaderboard.
 *
 * The underlying RPC (`public_economy_leaderboard`) intentionally returns
 * only username + balance — no UUIDs — because the leaderboard view is
 * privacy-safe by default.
 *
 * The frontend (and the homepage Top 10 - Network card) renders Minecraft
 * skin heads from UUIDs via mc-heads.net, which is the most reliable
 * cross-platform lookup (works for Java accounts AND Bedrock players who
 * connect through GeyserMC, since their Geyser-issued UUIDs resolve too).
 *
 * To bring that same skin behavior to the economy board, we enrich each
 * row with a UUID from `minecraft_account_links` (filtered to verified
 * links) so the frontend can call `avatarUrl(uuid)` like the playtime
 * leaderboard does. Anything we can't resolve gets uuid: null and the
 * component falls back to the username-based path (Bedrock dot-prefix
 * names route to a Steve head; Java names hit the username lookup).
 */
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
    const usernames = rows
      .map((row) => row.minecraft_username)
      .filter((name): name is string => typeof name === "string" && name.length > 0)

    // Look up UUIDs for the usernames on the board. Uses `ilike` via `.in`
    // would be exact-match only — we do a case-insensitive set lookup by
    // fetching all verified links and matching client-side, since the set
    // is at most 10 names. This avoids any RLS dance.
    const uuidsByLowerName = new Map<string, string>()

    if (usernames.length > 0) {
      try {
        const supabase = getSupabaseServiceRoleClient()
        const { data: links, error: linksError } = await supabase
          .from("minecraft_account_links")
          .select("minecraft_username,minecraft_uuid")
          .eq("status", "verified")
          .not("minecraft_uuid", "is", null)
          .in("minecraft_username", usernames)

        if (linksError) {
          console.warn("economy_leaderboard_links_lookup", describeError(linksError))
        } else if (Array.isArray(links)) {
          for (const link of links as AccountLinkRow[]) {
            if (link.minecraft_username && link.minecraft_uuid) {
              uuidsByLowerName.set(
                link.minecraft_username.toLowerCase(),
                link.minecraft_uuid
              )
            }
          }
        }
      } catch (lookupError) {
        // Non-fatal: we still return the leaderboard without UUIDs.
        console.warn("economy_leaderboard_links_unavailable", describeError(lookupError))
      }
    }

    const entries = rows.map((row, index) => {
      const name = row.minecraft_username ?? "Unknown player"
      const uuid = name ? uuidsByLowerName.get(name.toLowerCase()) ?? null : null
      return {
        position: Number(row.rank_position ?? index + 1),
        name,
        uuid,
        balanceMinor: String(row.balance_minor ?? 0)
      }
    })

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
