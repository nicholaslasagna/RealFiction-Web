import type { Metadata } from "next"
import Link from "next/link"
import { ExternalLink, Radio, UsersRound } from "lucide-react"

import { Reveal } from "@/components/reveal"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const metadata: Metadata = {
  title: "Discord",
  description: "Join the RealFiction Discord for updates, events, support, community chat, and live network activity."
}

export default function DiscordPage() {
  return (
    <section className="container-shell py-14">
      <Reveal className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <h1 className="display-font text-5xl font-semibold leading-tight md:text-6xl">Discord</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            Events, support, screenshots, updates, vote reminders, tournament notices, staff
            announcements, and community highlights.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="https://discord.com/invite/JkPpmzn">
                Join Discord
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/contact">Contact support</Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-5">
          <Card className="minecraft-card">
            <CardHeader>
              <UsersRound className="h-5 w-5 text-amber-200" />
              <CardTitle>Online members</CardTitle>
              <CardDescription>
                Discord widget integration is ready for a server widget ID or bot-backed member endpoint.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="minecraft-card">
            <CardHeader>
              <Radio className="h-5 w-5 text-emerald-200" />
              <CardTitle>Live network announcements</CardTitle>
              <CardDescription>
                Updates, maintenance, launches, votes, and tournament cards can publish to web and Discord together.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </Reveal>
    </section>
  )
}
