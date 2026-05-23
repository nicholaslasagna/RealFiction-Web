import type { Metadata } from "next"
import Image from "next/image"
import { ShieldCheck, Sparkles, Trophy } from "lucide-react"

import { PlaytimeLeaderboards } from "@/components/playtime-leaderboards"
import { Reveal } from "@/components/reveal"
import { Badge } from "@/components/ui/badge"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const metadata: Metadata = {
  title: "Leaderboards",
  description:
    "Top RealFiction players across SMP, Factions, Anarchy, Arcade, and the lobby network — refreshed from the live RealCore stat cache."
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
              Top players, real time on the server.
            </h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
              Network-wide playtime totals across every RealFiction backend. Boards refresh from the live stat
              cache, so they update as players log on and off.
            </p>
          </Reveal>
        </div>
      </div>

      <div className="container-shell py-10 md:py-14">
        <Reveal className="grid gap-5 md:grid-cols-3">
          <Card className="minecraft-card">
            <CardHeader>
              <Trophy className="h-5 w-5 text-amber-200" />
              <CardTitle>Network-wide totals</CardTitle>
              <CardDescription>Hours summed across SMP, Factions, Arcade, Anarchy, and lobby worlds.</CardDescription>
            </CardHeader>
          </Card>
          <Card className="minecraft-card">
            <CardHeader>
              <Sparkles className="h-5 w-5 text-amber-200" />
              <CardTitle>Live stat cache</CardTitle>
              <CardDescription>RealCore reports each session and the website caches the top 10 every minute.</CardDescription>
            </CardHeader>
          </Card>
          <Card className="minecraft-card">
            <CardHeader>
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
              <CardTitle>Fair counting</CardTitle>
              <CardDescription>Idempotent session math. Crashes and proxy transfers can&rsquo;t double-count.</CardDescription>
            </CardHeader>
          </Card>
        </Reveal>

        <Reveal className="mt-10">
          <PlaytimeLeaderboards />
        </Reveal>
      </div>
    </section>
  )
}
