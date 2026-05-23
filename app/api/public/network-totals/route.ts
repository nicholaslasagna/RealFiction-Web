import { describeError, safeJsonError } from "@/lib/security"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"

// PostgREST surfaces these codes when the RPC or its dependencies haven't been
// applied yet (42883: function does not exist, 42P01: relation does not
// exist, 42704: undefined object). We turn those into HTTP 503 so the
// homepage hero/spotlight components can distinguish "warming up" from a real
// 5xx and render a graceful placeholder instead of an error wall.
const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

type SummaryRow = {
  total_playtime_seconds: number | string | null
  tracked_players: number | string | null
  refreshed_at: string | null
}

export async function GET() {
  try {
    const { data, error } = await callServiceRoleRpc<SummaryRow[] | SummaryRow | null>(
      "network_summary",
      {}
    )

    if (error) {
      console.error("public_network_totals_rpc", describeError(error))
      const status = error.code && MISSING_SCHEMA_CODES.has(error.code) ? 503 : 500
      return safeJsonError("Network totals unavailable.", status)
    }

    const summary = Array.isArray(data) ? data[0] : data

    if (!summary) {
      // network_summary() always RETURNS QUERY a single row; an absent row
      // means the function ran but the underlying table is empty or
      // unreachable in a way PostgREST didn't surface as an error code.
      // Treat it as a transient warm-up state rather than a 200 with zeros so
      // clients can show "warming up" copy.
      return safeJsonError("Network totals unavailable.", 503)
    }

    const totalPlaytimeSeconds = Number(summary.total_playtime_seconds ?? 0)
    const trackedPlayers = Number(summary.tracked_players ?? 0)
    const refreshedAt = summary.refreshed_at ?? new Date().toISOString()

    return new Response(
      JSON.stringify({
        totalPlaytimeSeconds: Number.isFinite(totalPlaytimeSeconds) ? totalPlaytimeSeconds : 0,
        trackedPlayers: Number.isFinite(trackedPlayers) ? trackedPlayers : 0,
        refreshedAt
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
    console.error("public_network_totals_error", describeError(error))
    return safeJsonError("Network totals unavailable.", 500)
  }
}
