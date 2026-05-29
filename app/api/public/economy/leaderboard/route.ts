import { describeError, safeJsonError } from "@/lib/security"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

/**
 * Row shape returned by the `public_economy_leaderboard` RPC.
 *
 * Migration 029 added `minecraft_uuid` to the return type so the website
 * can render Minecraft skin heads through the same mc-heads.net / UUID
 * path the playtime "Top 10 - Network" board uses.
 *
 * The RPC's UUID is authoritative WHEN it is present and well-formed, but
 * it can be absent or unusable in two real cases:
 *   1. Migration 029 has not been applied to the live database yet — the
 *      deployed function still returns only rank + username + balance, so
 *      `minecraft_uuid` comes back undefined for every row.
 *   2. The economy import (`economy_balances`) stored a non-UUID key for a
 *      player (username / XUID / offline id). The column shape check only
 *      requires `^[A-Za-z0-9_.:-]{8,48}$`, so those values pass through but
 *      mc-heads.net can't resolve them.
 *
 * In both cases the row falls back to the username path, and for Bedrock
 * players (Geyser dot-prefix names like ".Zaxthezack") that lands on the
 * generic Steve head — even though the network board, sitting right next to
 * it, shows their real Bedrock skin.
 *
 * To match the network board exactly we enrich here from the SAME identity
 * source it uses: `network_stat_totals.subject_id` is the player's real
 * `player.getUniqueId()` UUID (a Geyser UUID for Bedrock, which mc-heads.net
 * resolves), keyed against `display_name` (the in-game name, including the
 * dot prefix). This enrichment needs no DB migration — the service-role
 * client bypasses RLS — so the board is correct on the next web deploy.
 */
type EconomyLeaderboardRow = {
  rank_position: number | string
  minecraft_uuid: string | null
  minecraft_username: string | null
  balance_minor: number | string
}

type NetworkStatIdentityRow = {
  display_name: string | null
  subject_id: string | null
}

/**
 * True when a value is a Minecraft UUID mc-heads.net can render — exactly
 * the rule `avatarUrl()` applies on the frontend (32 hex chars once dashes
 * are stripped). Java UUIDs and Geyser/Floodgate Bedrock UUIDs both pass;
 * usernames, XUIDs, and offline ids do not. Kept in sync with
 * `lib/format-playtime.ts#avatarUrl` so the route never prefers a UUID the
 * frontend would reject.
 */
function isRenderableUuid(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false
  const cleaned = value.replace(/-/g, "").trim().toLowerCase()
  return /^[0-9a-f]{32}$/.test(cleaned)
}

/**
 * Resolve canonical UUIDs for the given in-game names from the network
 * stats identity table (the Top 10 - Network board's own source). Returns a
 * lowercased-name -> uuid map. Non-fatal: any failure (missing config, RLS,
 * transient error) yields an empty map so the leaderboard still renders with
 * whatever UUIDs the RPC provided.
 */
async function resolveCanonicalUuids(names: string[]): Promise<Map<string, string>> {
  const byLowerName = new Map<string, string>()
  if (names.length === 0) {
    return byLowerName
  }

  try {
    const supabase = getSupabaseServiceRoleClient()
    // A player has one row per tracked stat_key (playtime.total, votes.total,
    // ...), all carrying the same subject_id + display_name, so we match on
    // display_name across every stat and dedupe to one UUID per name. The
    // name set is at most the board size (10), so the IN list stays tiny.
    const { data, error } = await supabase
      .from("network_stat_totals")
      .select("display_name,subject_id")
      .eq("subject_type", "player")
      .in("display_name", names)
      .limit(500)

    if (error) {
      console.warn("economy_leaderboard_identity_lookup", describeError(error))
      return byLowerName
    }

    for (const row of (data ?? []) as NetworkStatIdentityRow[]) {
      const name = row.display_name
      const uuid = row.subject_id
      if (name && isRenderableUuid(uuid)) {
        // First renderable UUID per name wins; duplicates share the same id.
        const key = name.toLowerCase()
        if (!byLowerName.has(key)) {
          byLowerName.set(key, uuid)
        }
      }
    }
  } catch (lookupError) {
    // Non-fatal: render the board without the enriched UUIDs.
    console.warn("economy_leaderboard_identity_unavailable", describeError(lookupError))
  }

  return byLowerName
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

    // Only look up names the RPC couldn't already give us a renderable UUID
    // for. (Once migration 029 is live and the economy row has a good UUID,
    // that wins and we skip the lookup for that player.)
    const namesNeedingUuid = rows
      .filter((row) => !isRenderableUuid(row.minecraft_uuid))
      .map((row) => row.minecraft_username)
      .filter((name): name is string => typeof name === "string" && name.length > 0)

    const canonicalByName = await resolveCanonicalUuids(Array.from(new Set(namesNeedingUuid)))

    const entries = rows.map((row, index) => {
      const name = row.minecraft_username ?? "Unknown player"
      // Prefer the RPC's UUID when it's renderable; otherwise fall back to the
      // canonical network-stats UUID (same id the Top 10 - Network board uses).
      const uuid = isRenderableUuid(row.minecraft_uuid)
        ? row.minecraft_uuid
        : (row.minecraft_username
            ? canonicalByName.get(row.minecraft_username.toLowerCase()) ?? null
            : null)

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
