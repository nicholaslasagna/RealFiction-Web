import Link from "next/link"
import { Crown, Trophy } from "lucide-react"

import { Reveal } from "@/components/reveal"
import { Badge } from "@/components/ui/badge"
import { avatarUrl, formatPlaytimeShort } from "@/lib/format-playtime"

// Server-rendered card that highlights the #1 player on the network playtime
// board. Backed by the same public leaderboard API the /leaderboards page
// uses, queried with limit=1. Same fail-soft contract as NetworkHeroStats:
// any unhealthy response returns null and the component drops to a graceful
// "awaiting first session" state instead of throwing or rendering an error.

type LeaderboardEntry = {
  position: number
  uuid: string
  name: string | null
  value: number
}

type LeaderboardResponse = {
  statKey: string
  subjectType: string
  entries: LeaderboardEntry[]
}

function siteOrigin() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://realfiction.live"
}

async function fetchTopPlayer(): Promise<LeaderboardEntry | null> {
  try {
    const url = `${siteOrigin()}/api/public/stats/leaderboard?key=playtime.total&limit=1`
    const response = await fetch(url, { next: { revalidate: 60 } })

    if (!response.ok) {
      return null
    }

    const json = (await response.json()) as LeaderboardResponse
    const entries = Array.isArray(json.entries) ? json.entries : []
    const top = entries[0]

    if (!top || typeof top.value !== "number") {
      return null
    }

    return top
  } catch {
    return null
  }
}

export async function TopPlayerSpotlight() {
  const top = await fetchTopPlayer()
  const avatar = top ? avatarUrl(top.uuid, 96) : null

  return (
    <Reveal delay={0.05} className="h-full">
      <article className="minecraft-card flex h-full flex-col gap-5 p-6 md:p-7">
        <div className="flex items-center gap-2.5">
          <Trophy className="h-5 w-5 text-amber-200" aria-hidden />
          <Badge variant="warning" className="font-mono text-[11px] uppercase tracking-[0.16em]">
            Top network player
          </Badge>
        </div>

        <div className="flex items-center gap-5">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              src={avatar}
              width={96}
              height={96}
              className="h-20 w-20 rounded-md border border-white/10 shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
              loading="lazy"
            />
          ) : (
            <div
              aria-hidden
              className="flex h-20 w-20 items-center justify-center rounded-md border border-white/10 bg-white/5"
            >
              <Crown className="h-7 w-7 text-amber-200/60" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="minecraft-font text-[11px] uppercase tracking-[0.18em] text-amber-200/85">
              Most network playtime
            </p>
            <p className="display-font mt-1.5 truncate text-3xl font-semibold leading-tight">
              {top?.name ?? "Awaiting first session"}
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-200/30 bg-amber-200/12 px-2.5 py-1 font-mono text-sm text-amber-100">
              <Crown className="h-3.5 w-3.5" aria-hidden />
              {top ? formatPlaytimeShort(top.value) : "—"}
            </p>
          </div>
        </div>

        <p className="text-sm leading-7 text-muted-foreground">
          {top ? (
            <>
              Crowned by total network playtime, summed live across every backend. The full
              top 10 lives on the{" "}
              <Link
                href="/leaderboards"
                className="text-amber-200 underline-offset-4 hover:underline"
              >
                leaderboards page
              </Link>
              .
            </>
          ) : (
            <>
              Logged-in players will start appearing here once sessions sync from the network.{" "}
              <Link
                href="/leaderboards"
                className="text-amber-200 underline-offset-4 hover:underline"
              >
                See all leaderboards.
              </Link>
            </>
          )}
        </p>
      </article>
    </Reveal>
  )
}
