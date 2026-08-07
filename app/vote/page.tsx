import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"


import { Reveal } from "@/components/reveal"
import { VoteRow } from "@/components/vote/vote-row"
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
type VoteStreak = { current_streak: number; longest_streak: number; monthly_votes: number } | null

async function getVoteReadiness(): Promise<{
  signedIn: boolean
  readyBySlug: Record<string, number>
  streak: VoteStreak
}> {
  try {
    const user = await getAuthenticatedUser().catch(() => null)
    if (!user) {
      return { signedIn: false, readyBySlug: {}, streak: null }
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
      return { signedIn: true, readyBySlug: {}, streak: null }
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

    // The streak the page already had the data for but never showed. Same
    // service-role read, scoped to this user's own verified username.
    const { data: streakRow } = await supabase
      .from("vote_streaks")
      .select("current_streak,longest_streak,monthly_votes")
      .ilike("minecraft_username", link.minecraft_username)
      .maybeSingle()

    return { signedIn: true, readyBySlug, streak: (streakRow as VoteStreak) ?? null }
  } catch {
    return { signedIn: false, readyBySlug: {}, streak: null }
  }
}

export default async function VotePage() {
  const { signedIn, readyBySlug, streak } = await getVoteReadiness()
  const now = Date.now()

  // Ready first. This is the whole point of the redesign: the answer to "which
  // can I vote on right now?" should be the shape of the page, not something a
  // visitor derives by reading ten cooldown pills.
  const withState = voteSites.map((site) => {
    const readyAt = readyBySlug[site.slug] ?? null
    return { site, readyAt, ready: readyAt === null || readyAt <= now }
  })
  const ready = withState.filter((entry) => entry.ready)
  const cooling = withState.filter((entry) => !entry.ready)

  const monthly = streak?.monthly_votes ?? 0
  const nextMilestone = voteMilestones.find((milestone) => milestone.votes > monthly) ?? null
  const progress = nextMilestone ? Math.min(100, Math.round((monthly / nextMilestone.votes) * 100)) : 100

  return (
    <section>
      <div className="relative overflow-hidden border-b border-amber-200/10 py-12 md:py-16">
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
          <Reveal className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div className="min-w-0">
              <h1 className="display-font text-4xl font-semibold leading-tight md:text-6xl">
                Vote for RealFiction
              </h1>
              <p className="mt-3 max-w-xl text-base leading-7 text-muted-foreground">
                Ten lists, one streak. Every vote is free and takes a few seconds.
              </p>
            </div>

            {/* The headline number, where a hero paragraph used to be. */}
            {signedIn ? (
              <div className="flex items-end gap-6" data-testid="vote-summary">
                <div>
                  <div className="font-mono text-4xl font-semibold leading-none text-amber-100 tabular-nums">
                    {ready.length}
                    <span className="text-xl text-muted-foreground">/{voteSites.length}</span>
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">Ready now</div>
                </div>
                <div>
                  <div className="font-mono text-4xl font-semibold leading-none text-white tabular-nums">
                    {streak?.current_streak ?? 0}
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">Day streak</div>
                </div>
              </div>
            ) : null}
          </Reveal>
        </div>
      </div>

      <div className="container-shell py-8 md:py-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_280px] lg:gap-10">
          {/* ---- The board ------------------------------------------------ */}
          <Reveal>
            {ready.length > 0 ? (
              <>
                <h2 className="flex items-baseline gap-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-100">
                  {signedIn ? "Ready to vote" : "Vote sites"}
                  <span className="font-mono text-muted-foreground">{ready.length}</span>
                  {!signedIn ? (
                    <span className="font-normal normal-case tracking-normal text-muted-foreground">
                      · every 24h
                    </span>
                  ) : null}
                </h2>
                <div className="mt-2.5 divide-y divide-white/[0.06] border-y border-white/[0.06]">
                  {ready.map(({ site, readyAt }) => (
                    <VoteRow
                      key={site.slug}
                      name={site.name}
                      reward={site.reward}
                      href={site.href}
                      signedIn={signedIn}
                      readyAt={readyAt}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {cooling.length > 0 ? (
              <>
                <h2 className="mt-8 flex items-baseline gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  On cooldown
                  <span className="font-mono">{cooling.length}</span>
                </h2>
                <div className="mt-2.5 divide-y divide-white/[0.06] border-y border-white/[0.06]">
                  {cooling.map(({ site, readyAt }) => (
                    <VoteRow
                      key={site.slug}
                      name={site.name}
                      reward={site.reward}
                      href={site.href}
                      signedIn={signedIn}
                      readyAt={readyAt}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {!signedIn ? (
              <p className="mt-5 text-sm leading-6 text-muted-foreground">
                <Link href="/account" className="text-amber-100 underline underline-offset-4">
                  Sign in and link your Minecraft account
                </Link>{" "}
                to track cooldowns and build a streak.
              </p>
            ) : null}
          </Reveal>

          {/* ---- Progress rail -------------------------------------------- */}
          <Reveal delay={0.1}>
            <aside className="lg:sticky lg:top-28">
              <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Monthly progress
              </h2>

              {nextMilestone ? (
                <div className="mt-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-2xl font-semibold text-white tabular-nums">{monthly}</span>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {nextMilestone.votes}
                    </span>
                  </div>
                  {/* A block-progress bar: pixel-stepped rather than a smooth
                      gradient, which reads as Minecraft without being a gimmick. */}
                  <div
                    className="mt-1.5 h-2 w-full bg-black/40"
                    role="progressbar"
                    aria-valuenow={monthly}
                    aria-valuemin={0}
                    aria-valuemax={nextMilestone.votes}
                    aria-label={`${monthly} of ${nextMilestone.votes} votes toward ${nextMilestone.reward}`}
                  >
                    <div className="h-full bg-amber-200/80" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Next up: <span className="text-white">{nextMilestone.reward}</span>
                  </p>
                </div>
              ) : null}

              <ol className="mt-5 space-y-0 border-t border-white/[0.06]">
                {voteMilestones.map((milestone) => {
                  const reached = monthly >= milestone.votes
                  return (
                    <li
                      key={milestone.votes}
                      className="flex items-center gap-3 border-b border-white/[0.06] py-2"
                    >
                      <span
                        className={`font-mono text-sm tabular-nums ${
                          reached ? "text-amber-100" : "text-muted-foreground"
                        }`}
                      >
                        {String(milestone.votes).padStart(2, "0")}
                      </span>
                      <span className={`flex-1 text-sm ${reached ? "text-white" : "text-muted-foreground"}`}>
                        {milestone.reward}
                      </span>
                      {reached ? (
                        <span className="text-xs font-bold uppercase text-amber-100" aria-label="Reached">
                          ✓
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ol>

              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Rewards are cosmetic and progression-safe. Voting never affects combat or the economy.
              </p>
            </aside>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
