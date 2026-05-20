import type { Metadata } from "next"
import Link from "next/link"
import { ArrowUpRight, BarChart3, Gift, Medal, ShieldCheck } from "lucide-react"

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
    <section className="container-shell py-14">
      <Reveal className="max-w-4xl">
        <Badge variant="warning">
          <Medal className="mr-1.5 h-3.5 w-3.5" />
          Vote streak system
        </Badge>
        <h1 className="display-font mt-5 text-5xl font-semibold leading-tight md:text-6xl">Vote for RealFiction</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
          Vote across the network’s listings, build streaks, unlock daily progress rewards, compete
          for monthly leaderboards, and claim rewards through the account-linked queue.
        </p>
      </Reveal>

      <Reveal className="mt-8 grid gap-5 md:grid-cols-3">
        <Card>
          <CardHeader>
            <Gift className="h-5 w-5 text-primary" />
            <CardTitle>Daily rewards</CardTitle>
            <CardDescription>Each verified vote creates an idempotent reward queue entry.</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <BarChart3 className="h-5 w-5 text-primary" />
            <CardTitle>Monthly leaders</CardTitle>
            <CardDescription>Top voters can be featured without selling gameplay power.</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <ShieldCheck className="h-5 w-5 text-primary" />
            <CardTitle>Anti-abuse</CardTitle>
            <CardDescription>Cooldowns, account linking, IP hashing, and vote-site verification.</CardDescription>
          </CardHeader>
        </Card>
      </Reveal>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_330px]">
        <Reveal>
          <div className="grid gap-4 md:grid-cols-2">
            {voteSites.map((site, index) => (
              <Card key={site.name}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Badge variant="outline">Site {index + 1}</Badge>
                      <CardTitle className="mt-3">{site.name}</CardTitle>
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
          <aside className="premium-surface rounded-lg p-6 lg:sticky lg:top-28">
            <Badge variant="success">Progress rewards</Badge>
            <div className="mt-5 grid gap-4">
              {voteMilestones.map((milestone) => (
                <div key={milestone.votes} className="rounded-lg border border-border bg-background/45 p-4">
                  <div className="font-mono text-2xl font-semibold text-primary">{milestone.votes}</div>
                  <div className="text-sm text-muted-foreground">{milestone.reward}</div>
                </div>
              ))}
            </div>
          </aside>
        </Reveal>
      </div>
    </section>
  )
}
