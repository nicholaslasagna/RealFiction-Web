import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { ArrowUpRight } from "lucide-react"

import { ClockIcon } from "@/components/minecraft-icons"
import { Reveal } from "@/components/reveal"
import { VoteCountdown } from "@/components/vote-countdown"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { voteMilestones, voteSites } from "@/lib/data"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"
import { getAuthenticatedUser } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Vote",
  description: "Vote for RealFiction, track cooldowns, streaks, rewards, monthly top voters, and progress milestones."
}

// Per-user cooldowns are read per request, so the page can't be statically cached.
export const dynamic = "force-dynamic"

type VoteSiteRef = { slug?: string | null; cooldown_hours?: number | null } | null

/**
 * For the signed-in user, the epoch-ms "next vote allowed" time per site slug,
 * computed from their most recent recorded vote on each site + that site's
 * cooldown. Read server-side with the service role and scoped to the
 * authenticated user's own verified Minecraft username — the client never sees
 * or supplies these timestamps.
 */
async function getVoteReadiness(): Promise<{ signedIn: boolean; readyBySlug: Record<string, number> }> {
  try {
    const user = await getAuthenticatedUser().catch(() => null)
    if (!user) {
      return { signedIn: false, readyBySlug: {} }
    }

    const supabase = getSupabaseServiceRoleClient()
    const { data: link } = await supabase
      .from("minecraft_account_links")
      .select("minecraft_username")
      .eq("user_id", user.id)
      .eq("status", "verified")
      .order("verified_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!link?.minecraft_username) {
      return { signedIn: true, readyBySlug: {} }
    }

    const { data } = await supabase
      .from("votes")
      .select("voted_at, vote_sites(slug, cooldown_hours)")
      .ilike("minecraft_username", link.minecraft_username)
      .order("voted_at", { ascending: false })
      .limit(200)

    const readyBySlug: Record<string, number> = {}
    for (const row of (data ?? []) as Array<{ voted_at: string; vote_sites: VoteSiteRef }>) {
      const site = Array.isArray(row.vote_sites) ? row.vote_sites[0] : row.vote_sites
      const slug = site?.slug
      if (!slug || slug in readyBySlug) {
        continue
      }
      const cooldownHours = site?.cooldown_hours ?? 24
      readyBySlug[slug] = new Date(row.voted_at).getTime() + cooldownHours * 3_600_000
    }

    return { signedIn: true, readyBySlug }
  } catch {
    return { signedIn: false, readyBySlug: {} }
  }
}

export default async function VotePage() {
  const { signedIn, readyBySlug } = await getVoteReadiness()
  return (
    <section>
      <div className="relative overflow-hidden border-b border-amber-200/10 py-16 md:py-20">
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
            <h1 className="display-font text-5xl font-semibold leading-tight md:text-7xl">Vote for RealFiction</h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
              Help the server climb the lists, keep the community growing, and earn cosmetic-friendly
              rewards through account-linked vote streaks.
            </p>
          </Reveal>
        </div>
      </div>

      <div className="container-shell py-10 md:py-14">
      {/* Icon-free 3-up summary — calm, dark, easier on the eyes. */}
      <Reveal className="grid gap-4 md:grid-cols-3">
        {[
          {
            title: "Daily rewards",
            body: "Vote keys, profile points, and server-safe progress rewards."
          },
          {
            title: "Monthly top voters",
            body: "Leaderboards and showcase rewards for players who support the network."
          },
          {
            title: "Verified voting",
            body: "Cooldowns, account linking, and verified votes help keep rewards fair."
          }
        ].map((item) => (
          <div
            key={item.title}
            className="border border-amber-200/14 bg-black/24 p-5"
          >
            <h3
              className="text-lg text-white"
              style={{ fontFamily: "rf-h1, sans-serif" }}
            >
              {item.title}
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.body}</p>
          </div>
        ))}
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
                    <VoteCountdown
                      hours={site.cooldownHours}
                      signedIn={signedIn}
                      readyAt={readyBySlug[site.slug] ?? null}
                    />
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
                <div key={milestone.votes} className="rounded-lg border border-amber-200/14 bg-black/24 p-4">
                  <div className="flex items-center gap-2">
                    <ClockIcon className="h-4 w-4" />
                    <div className="font-mono text-2xl font-semibold text-amber-100">{milestone.votes}</div>
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
