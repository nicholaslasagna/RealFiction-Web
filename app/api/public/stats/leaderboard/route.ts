import { describeError, safeJsonError } from "@/lib/security"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"

const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

// Public read of leaderboard snapshots for the website. Only non-sensitive,
// leaderboard-style stats are exposed; everything else (notably money.*) needs
// the authenticated plugin route. The cache RPC throttles refreshes and the
// response is CDN-cacheable, so this stays cheap under traffic.
//
// Keep this list synchronized with docs/REALCORE_PLUGIN.md and the RealCore
// stats producers. Adding a prefix here is the public-exposure switch.
const PUBLIC_STAT_PREFIXES = [
  "playtime.",
  "votes.",
  "kills.",
  "deaths.",
  "blocks_broken."
]

type LeaderboardRow = {
  rank_position: number
  subject_id: string
  display_name: string | null
  value: number | string
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const statKey = (url.searchParams.get("key") ?? "").trim().toLowerCase()
    const subjectType = (url.searchParams.get("subjectType") ?? "player").trim().toLowerCase()
    const limitRaw = Number(url.searchParams.get("limit") ?? 10)
    const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 10))

    if (!/^[a-z0-9_.-]{2,80}$/.test(statKey) || !PUBLIC_STAT_PREFIXES.some((prefix) => statKey.startsWith(prefix))) {
      return Response.json({ error: "Unknown or non-public stat key." }, { status: 400 })
    }
    if (!/^[a-z]{2,32}$/.test(subjectType)) {
      return Response.json({ error: "Invalid subject type." }, { status: 400 })
    }

    const { data, error } = await callServiceRoleRpc<LeaderboardRow[]>("get_stat_leaderboard", {
      p_stat_key: statKey,
      p_subject_type: subjectType,
      p_limit: limit,
      p_max_age_seconds: 300
    })

    if (error) {
      console.error("public_stats_leaderboard_rpc", describeError(error))
      const status = error.code && MISSING_SCHEMA_CODES.has(error.code) ? 503 : 500
      return safeJsonError("Leaderboard could not be loaded.", status)
    }

    const entries = ((data ?? []) as LeaderboardRow[]).map((row) => ({
      position: row.rank_position,
      uuid: row.subject_id,
      name: row.display_name,
      value: Number(row.value ?? 0)
    }))

    return new Response(JSON.stringify({ statKey, subjectType, entries }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120"
      }
    })
  } catch (error) {
    console.error("public_stats_leaderboard_error", describeError(error))
    return safeJsonError("Leaderboard could not be loaded.", 500)
  }
}
