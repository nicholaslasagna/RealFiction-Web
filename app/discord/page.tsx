import type { Metadata } from "next"
import Link from "next/link"
import { ExternalLink } from "lucide-react"

import { Reveal } from "@/components/reveal"
import { Button } from "@/components/ui/button"
import { getLatestAnnouncement } from "@/lib/announcements/read"
import { DISCORD_INVITE_URL, fetchDiscordCounts } from "@/lib/discord/counts"
import { updates } from "@/lib/data"

export const metadata: Metadata = {
  title: "Discord",
  description:
    "Join the RealFiction Discord for updates, events, support, community chat, and live network activity."
}

// Counts and the announcement are both cached for five minutes by the fetch
// layer, so this renders per request without becoming a Discord API call.
export const dynamic = "force-dynamic"

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(new Date(iso))
}

export default async function DiscordPage() {
  // The announcement comes from OUR database, not from reading Discord.
  // RealFiction publishes; Discord receives a copy.
  const [counts, announcement] = await Promise.all([fetchDiscordCounts(), getLatestAnnouncement()])

  return (
    <section className="container-shell py-10 md:py-14">
      {/* ---- Identity + join, on one line at desktop --------------------- */}
      <Reveal className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 border-b border-amber-200/15 pb-6">
        <div className="min-w-0">
          <h1 className="display-font text-4xl font-semibold leading-tight md:text-5xl">Discord</h1>
          <p className="mt-2 max-w-xl text-base leading-7 text-muted-foreground">
            Events, support, screenshots, and the fastest way to reach staff.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          {counts.memberCount !== null ? (
            <div className="flex items-end gap-6" data-testid="discord-counts">
              <div>
                <div className="font-mono text-3xl font-semibold leading-none text-white tabular-nums">
                  {counts.memberCount.toLocaleString("en-US")}
                </div>
                <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">Members</div>
              </div>
              {counts.onlineCount !== null ? (
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 bg-emerald-400" aria-hidden />
                    <span className="font-mono text-3xl font-semibold leading-none text-white tabular-nums">
                      {counts.onlineCount.toLocaleString("en-US")}
                    </span>
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">Online now</div>
                </div>
              ) : null}
            </div>
          ) : null}

          <Button asChild size="lg">
            <Link href={DISCORD_INVITE_URL}>
              Join Discord
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </Reveal>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_260px] lg:gap-12">
        {/* ---- Latest announcement -------------------------------------- */}
        <Reveal className="min-w-0">
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Latest announcement
          </h2>

          {announcement ? (
            <article className="mt-3" data-testid="discord-announcement">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="font-semibold text-amber-100">
                  {announcement.authorDisplay || "RealFiction"}
                </span>
                {announcement.publishedAt ? (
                  <time dateTime={announcement.publishedAt}>{formatWhen(announcement.publishedAt)}</time>
                ) : null}
                <span>{announcement.category}</span>
                {announcement.mirrored ? (
                  <span className="text-muted-foreground">· also posted in Discord</span>
                ) : null}
              </div>

              <h3 className="display-font mt-1.5 text-xl leading-snug text-white">
                <Link href={`/updates/${announcement.slug}`} className="transition hover:text-amber-100">
                  {announcement.title}
                </Link>
              </h3>

              {/* Plain text in a text node. There is no HTML sink on this page. */}
              {announcement.excerpt ? (
                <p className="mt-1.5 border-l-2 border-amber-200/40 pl-4 text-[15px] leading-7 text-slate-200">
                  {announcement.excerpt}
                </p>
              ) : null}

              <Link
                href={`/updates/${announcement.slug}`}
                className="mt-3 inline-block text-sm text-amber-100 underline underline-offset-4"
              >
                Read the full update
              </Link>
            </article>
          ) : (
            <p className="mt-3 border-l-2 border-white/10 pl-4 text-[15px] leading-7 text-muted-foreground">
              No announcements yet. New ones appear here and in the Discord server.{" "}
              <Link href={DISCORD_INVITE_URL} className="text-amber-100 underline underline-offset-4">
                Open Discord
              </Link>
            </p>
          )}

          {/* ---- Recent from the network ------------------------------
              Real content from our own updates, not filler. Without it the
              column collapses to a single line whenever an announcement is
              unavailable, which is the dead space this page had before. */}
          <h2 className="mt-9 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Recent from the network
          </h2>
          <ol className="mt-3 border-t border-white/[0.06]">
            {updates.slice(0, 4).map((update) => (
              <li key={update.slug} className="border-b border-white/[0.06]">
                <Link
                  href={`/updates/${update.slug}`}
                  className="group flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5"
                >
                  <time dateTime={update.date} className="font-mono text-xs text-muted-foreground">
                    {update.date}
                  </time>
                  <span className="min-w-0 flex-1 text-sm text-slate-200 transition group-hover:text-amber-100">
                    {update.title}
                  </span>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {update.type}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          <Link
            href="/updates"
            className="mt-3 inline-block text-sm text-amber-100 underline underline-offset-4"
          >
            All updates
          </Link>
        </Reveal>

        {/* ---- Where to go --------------------------------------------- */}
        <Reveal delay={0.1}>
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Where to go
          </h2>
          <ul className="mt-3 border-t border-white/[0.06]">
            {[
              { label: "Report a player", href: "/rules", note: "Rules & enforcement" },
              { label: "Billing or refunds", href: "/contact", note: "Support inbox" },
              { label: "Patch notes", href: "/updates", note: "Every change, dated" },
              { label: "Vote rewards", href: "/vote", note: "Ten lists, one streak" }
            ].map((item) => (
              <li key={item.href} className="border-b border-white/[0.06]">
                <Link
                  href={item.href}
                  className="group flex items-baseline justify-between gap-3 py-2.5 transition hover:text-amber-100"
                >
                  <span className="text-sm text-slate-200 group-hover:text-amber-100">{item.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{item.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  )
}
