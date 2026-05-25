import type { Metadata } from "next"
import Image from "next/image"
import { Trophy } from "lucide-react"

import { EconomyLeaderboard } from "@/components/economy-leaderboard"
import { PlaytimeLeaderboards } from "@/components/playtime-leaderboards"
import { Reveal } from "@/components/reveal"
import { Badge } from "@/components/ui/badge"

export const metadata: Metadata = {
  title: "Leaderboards",
  description:
    "Top RealFiction players across playtime and economy leaderboards."
}

export default function LeaderboardsPage() {
  return (
    <section>
      <div className="relative overflow-hidden border-b border-amber-200/10 py-16 md:py-20">
        <Image
          alt="RealFiction leaderboards"
          src="/images/tournaments.png"
          fill
          priority
          className="-z-20 object-cover opacity-30 blur-[1px]"
          sizes="100vw"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-background/68 via-background/86 to-background" />
        <div className="container-shell">
          <Reveal className="max-w-4xl">
            <Badge variant="warning">
              <Trophy className="mr-1.5 h-3.5 w-3.5" />
              Network leaderboards
            </Badge>
            <h1 className="display-font mt-5 text-5xl font-semibold leading-tight md:text-7xl">
              Top players across RealFiction.
            </h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
              See who is leading the network in playtime and balance. Simple boards, refreshed from RealFiction
              server data.
            </p>
          </Reveal>
        </div>
      </div>

      <div className="container-shell py-10 md:py-14">
        <Reveal>
          <EconomyLeaderboard />
        </Reveal>

        <Reveal className="mt-8">
          <PlaytimeLeaderboards />
        </Reveal>
      </div>
    </section>
  )
}
