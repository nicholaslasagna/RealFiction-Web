import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { ArrowUpRight, CalendarDays, Gift, Medal, ShieldCheck, Trophy } from "lucide-react"

import { Reveal } from "@/components/reveal"
import { VoteCountdown } from "@/components/vote-countdown"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { voteMilestones, voteSites } from "@/lib/data"

export const metadata: Metadata = {
  title: "Vote",
  description: "Vote for RealFiction, track cooldowns, streaks, rewards, monthly top voters, and progress milestones."
}

export default function VotePage() {
  return (
    <section>
      <div className="relative overflow-hidden border-b border-border py-16 md:py-20">
        <Image
          alt="RealFiction voting hub"
          src="/images/tournaments.png"
          fill
          priority
          className="-z-20 object-cover opacity-34 blur-[1px]"
          sizes="100vw"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-background/68 via-background/86 to-background" />
        <div className="container-shell">
          <Reveal className="max-w-4xl">
            <Badge variant="warning">
              <Medal className="mr-1.5 h-3.5 w-3.5" />
              Voting hub
            </Badge>
            <h1 className="display-font mt-5 text-5xl font-semibold leading-tight md:text-7xl">Vote for RealFiction</h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
              Help the server climb the lists, keep the community growing, and earn cosmetic-friendly
              rewards through account-linked vote streaks.
            </p>
          </Reveal>
        </div>
      </div>

      <div className="container-shell py-10 md:py-14">
      <Reveal className="grid gap-5 md:grid-cols-3">
        <Card className="minecraft-card">
          <CardHeader>
            <Gift className="h-5 w-5 text-primary" />
            <CardTitle>Daily rewards</CardTitle>
            <CardDescription>Vote keys, profile points, and server-safe progress rewards.</CardDescription>
          </CardHeader>
        </Card>
        <Card className="minecraft-card">
          <CardHeader>
            <Trophy className="h-5 w-5 text-primary" />
            <CardTitle>Monthly top voters</CardTitle>
            <CardDescription>Leaderboards and showcase rewards for players who support the network.</CardDescription>
          </CardHeader>
        </Card>
        <Card className="minecraft-card">
          <CardHeader>
            <ShieldCheck className="h-5 w-5 text-primary" />
            <CardTitle>Verified voting</CardTitle>
            <CardDescription>Cooldowns, account linking, and verified votes help keep rewards fair.</CardDescription>
          </CardHeader>
        </Card>
      </Reveal>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_330px]">
        <Reveal>
          <div className="grid gap-4 md:grid-cols-2">
            {voteSites.map((site, index) => (
              <Card key={site.name} className="minecraft-card">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Badge variant="outline">Vote site {index + 1}</Badge>
                      <CardTitle className="display-font mt-3 text-2xl">{site.name}</CardTitle>
                    </div>
                    <VoteCountdown hours={site.cooldownHours} />
                  </div>
                  <CardDescription>{site.reward}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline" className="w-full">
                    <Link href={site.href}>
                      Vote
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <aside className="minecraft-panel rounded-lg p-6 lg:sticky lg:top-28">
            <Badge variant="success">Progress rewards</Badge>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Keep a streak alive and stack monthly progress without changing gameplay balance.
            </p>
            <div className="mt-5 grid gap-4">
              {voteMilestones.map((milestone) => (
                <div key={milestone.votes} className="rounded-lg border border-border bg-secondary p-4">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    <div className="font-mono text-2xl font-semibold text-primary">{milestone.votes}</div>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">{milestone.reward}</div>
                </div>
              ))}
            </div>
          </aside>
        </Reveal>
      </div>
      </div>
    </section>
  )
}
