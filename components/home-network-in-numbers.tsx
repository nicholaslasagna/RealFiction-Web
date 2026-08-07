import Link from "next/link"

import { avatarUrl, formatPlaytimeLong, formatPlaytimeShort } from "@/lib/format-playtime"

/**
 * Mockup "The whole network, in numbers." section, wired to real data.
 *
 * Cards:
 *   1. Network playtime  ← /api/public/network-totals (totalPlaytimeSeconds)
 *   2. Tracked players   ← /api/public/network-totals (count) + top 4 skins
 *                          from playtime leaderboard
 *   3. Top network player ← /api/public/stats/leaderboard?key=playtime.total
 *                            (real Minecraft skin head, name, playtime)
 *
 * Fail-soft: any error returns null/0 so the cards stay visible with
 * placeholders rather than crashing the homepage.
 */

type NetworkTotals = {
  totalPlaytimeSeconds: number
  trackedPlayers: number
}

type LeaderboardEntry = {
  position: number
  uuid: string
  name: string | null
  value: number
}

function siteOrigin() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://realfiction.live"
}

async function fetchNetworkTotals(): Promise<NetworkTotals | null> {
  try {
    const response = await fetch(`${siteOrigin()}/api/public/network-totals`, {
      next: { revalidate: 60 }
    })
    if (!response.ok) return null
    const json = (await response.json()) as Partial<NetworkTotals>
    if (
      typeof json.totalPlaytimeSeconds !== "number" ||
      typeof json.trackedPlayers !== "number"
    ) {
      return null
    }
    return {
      totalPlaytimeSeconds: json.totalPlaytimeSeconds,
      trackedPlayers: json.trackedPlayers
    }
  } catch {
    return null
  }
}

async function fetchTopPlayers(limit: number): Promise<LeaderboardEntry[]> {
  try {
    const url = `${siteOrigin()}/api/public/stats/leaderboard?key=playtime.total&limit=${limit}`
    const response = await fetch(url, { next: { revalidate: 60 } })
    if (!response.ok) return []
    const json = (await response.json()) as { entries?: LeaderboardEntry[] }
    return Array.isArray(json.entries) ? json.entries : []
  } catch {
    return []
  }
}

export async function HomeNetworkInNumbers() {
  // Fetch both endpoints in parallel — they're independent, both cached 60s.
  const [totals, topPlayers] = await Promise.all([
    fetchNetworkTotals(),
    fetchTopPlayers(4)
  ])

  const totalPlaytime = totals
    ? formatPlaytimeLong(totals.totalPlaytimeSeconds)
    : "—"
  const trackedCount = totals?.trackedPlayers ?? 0
  const trackedDisplay = trackedCount.toLocaleString()
  const top = topPlayers[0] ?? null

  return (
    <section className="section-tinted">
      <h2 className="section-title">The whole network, in numbers.</h2>
      <p className="section-kicker">
        Totals roll up SMP, Factions, Anarchy, Arcade, and lobby playtime from across the
        RealFiction network.
      </p>

      <div className="stats-grid">
        {/* ── Card 1: Network playtime ──
            The decorative 62% gradient bar was removed: it didn't
            correspond to any real metric, and a fake-meaning progress
            bar on top of a real number is worse than no bar. */}
        <div className="stat-card">
          <div className="stat-eyebrow">Network playtime</div>
          <div className="stat-value">{totalPlaytime}</div>
          <div className="stat-foot" style={{ marginTop: 20 }}>
            Across SMP · Factions · Arcade · Anarchy · Lobby
          </div>
        </div>

        {/* ── Card 2: Tracked players + top N skins ── */}
        <div className="stat-card emerald">
          <div className="stat-eyebrow">Tracked players</div>
          <div className="stat-value" style={{ color: "var(--mc-green)" }}>
            {trackedDisplay}
          </div>
          <div style={{ marginTop: 18, display: "flex" }}>
            {topPlayers.length > 0
              ? topPlayers.slice(0, 4).map((player, i) => {
                  const skin = avatarUrl(player.uuid, 64)
                  return (
                    <div
                      key={`${player.uuid}-${player.position}`}
                      style={{
                        width: 32,
                        height: 32,
                        background: skin ? `url(${skin}) center / cover` : "#1c2a40",
                        border: "2px solid var(--navy-card)",
                        marginLeft: i ? -8 : 0,
                        imageRendering: "pixelated"
                      }}
                      // `role="img"` is required, not decorative. ARIA
                      // prohibits `aria-label` on a generic div, so without a
                      // role a screen reader DISCARDS the name entirely and the
                      // avatar is announced as nothing. The skin is painted as
                      // a CSS background, so there is no <img> to carry alt.
                      role="img"
                      aria-label={player.name ?? "Unknown player"}
                      title={player.name ?? "Unknown player"}
                    />
                  )
                })
              : // No data yet — show subtle placeholder squares
                Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      width: 32,
                      height: 32,
                      background: "rgba(255,255,255,0.05)",
                      border: "2px solid var(--navy-card)",
                      marginLeft: i ? -8 : 0
                    }}
                  />
                ))}
          </div>
          <div className="stat-foot">Linked accounts seen on the network.</div>
        </div>

        {/* ── Card 3: Top network player with real Minecraft skin ── */}
        <div className="stat-card navy">
          <div className="stat-eyebrow">Top network player</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}>
            <TopPlayerHead entry={top} />
            <div>
              <div
                style={{
                  fontFamily: "rf-h1, sans-serif",
                  fontSize: 22,
                  color: "white",
                  lineHeight: 1.05
                }}
              >
                {top?.name ?? "Awaiting first session"}
              </div>
              <div
                className="f-mc"
                style={{ color: "var(--gold)", fontSize: 15, marginTop: 4 }}
              >
                {top ? formatPlaytimeShort(top.value) + " played" : "—"}
              </div>
            </div>
          </div>
          <div className="stat-foot">
            Full top 10 lives on the <Link href="/leaderboards">leaderboards page</Link>.
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * Renders the top player's real Minecraft skin head if we have a valid
 * UUID; falls back to a neutral pixel-bordered square otherwise so the
 * card stays the right shape on empty / pre-cache states.
 */
function TopPlayerHead({ entry }: { entry: LeaderboardEntry | null }) {
  const skin = entry ? avatarUrl(entry.uuid, 96) : null

  if (skin) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt=""
        src={skin}
        width={56}
        height={56}
        loading="lazy"
        style={{
          width: 56,
          height: 56,
          border: "2px solid #0a0f18",
          background: "#1c2a40",
          padding: 2,
          imageRendering: "pixelated",
          boxShadow:
            "inset 0 2px 0 rgba(255,255,255,0.08), inset 0 -2px 0 rgba(0,0,0,0.3)"
        }}
      />
    )
  }

  return (
    <div
      aria-hidden
      style={{
        width: 56,
        height: 56,
        border: "2px solid #0a0f18",
        background: "#1c2a40",
        imageRendering: "pixelated"
      }}
    />
  )
}
