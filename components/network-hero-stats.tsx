import type { ReactNode } from "react"
import { Globe2, Users } from "lucide-react"

import { Reveal } from "@/components/reveal"
import { Badge } from "@/components/ui/badge"
import { formatPlaytimeLong } from "@/lib/format-playtime"

// Server-rendered hero card backed by /api/public/network-totals. The route
// itself sits behind a 60-second CDN window (s-maxage=60); the fetch below
// uses Next.js's data cache (revalidate: 60) so the homepage doesn't issue a
// fresh round-trip on every render. Failures here must NEVER block the
// homepage render: any error path returns null and the component drops to a
// subtle placeholder rather than throwing.

type NetworkTotals = {
  totalPlaytimeSeconds: number
  trackedPlayers: number
  refreshedAt: string
}

function siteOrigin() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://realfiction.live"
}

async function fetchNetworkTotals(): Promise<NetworkTotals | null> {
  try {
    const response = await fetch(`${siteOrigin()}/api/public/network-totals`, {
      next: { revalidate: 60 }
    })

    if (!response.ok) {
      return null
    }

    const json = (await response.json()) as Partial<NetworkTotals>

    if (typeof json.totalPlaytimeSeconds !== "number" || typeof json.trackedPlayers !== "number") {
      return null
    }

    return {
      totalPlaytimeSeconds: json.totalPlaytimeSeconds,
      trackedPlayers: json.trackedPlayers,
      refreshedAt: json.refreshedAt ?? new Date().toISOString()
    }
  } catch {
    return null
  }
}

export async function NetworkHeroStats() {
  const totals = await fetchNetworkTotals()

  return (
    <Reveal className="h-full">
      <article className="minecraft-card flex h-full flex-col p-7 md:p-8">
        <div className="flex items-center gap-2.5">
          <Globe2 className="h-5 w-5 text-primary" aria-hidden />
          <Badge variant="outline" className="font-mono text-[11px] uppercase tracking-[0.10em]">
            Live network
          </Badge>
        </div>

        <h3 className="display-font mt-5 text-3xl leading-tight tracking-[-0.022em] text-foreground md:text-4xl">
          The whole network, in numbers.
        </h3>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          Totals roll up SMP, Factions, Anarchy, Arcade, and lobby playtime from across the
          RealFiction network.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <StatTile
            label="Network playtime"
            value={totals ? formatPlaytimeLong(totals.totalPlaytimeSeconds) : null}
          />
          <StatTile
            label={
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" aria-hidden /> Tracked players
              </span>
            }
            value={totals ? totals.trackedPlayers.toLocaleString() : null}
          />
        </div>

        {totals === null ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Live totals will appear once the network stat cache is warm.
          </p>
        ) : null}
      </article>
    </Reveal>
  )
}

function StatTile({ label, value }: { label: ReactNode; value: string | null }) {
  return (
    <div className="rounded-lg border border-border bg-secondary p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.10em] text-muted-foreground">{label}</p>
      <p
        className="display-font mt-2 text-3xl leading-none tracking-[-0.025em] text-foreground md:text-4xl"
        aria-live="polite"
      >
        {value ?? "—"}
      </p>
    </div>
  )
}
