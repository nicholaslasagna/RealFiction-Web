import type { Metadata } from "next"
import Link from "next/link"

import { Reveal } from "@/components/reveal"
import { updates } from "@/lib/data"

export const metadata: Metadata = {
  title: "Updates",
  description: "RealFiction news, announcements, event posts, changelogs, and store policy updates."
}

export default function UpdatesPage() {
  return (
    <section className="container-shell py-10 md:py-14">
      <Reveal className="border-b border-amber-200/15 pb-6">
        <h1 className="display-font text-4xl font-semibold leading-tight md:text-5xl">Updates</h1>
        <p className="mt-2 max-w-2xl text-base leading-7 text-muted-foreground">
          Every change to the network and the site, newest first.
        </p>
      </Reveal>

      {/* A news feed, not a stack of cards. Each entry is one row with a hairline
          rule under it; the version sits in the left gutter where a reader can
          scan it without it becoming a boxed-off chip. */}
      <ol className="mt-2">
        {updates.map((update, index) => (
          <li key={update.slug}>
            <Reveal delay={Math.min(index * 0.04, 0.2)}>
              <Link
                href={`/updates/${update.slug}`}
                className="group grid gap-x-6 gap-y-1.5 border-b border-white/[0.07] py-5 transition sm:grid-cols-[104px_1fr] hover:border-amber-200/30"
                aria-label={`Read full patch notes: ${update.title}`}
              >
                {/* Left gutter: version + date, compact metadata. */}
                <div className="flex items-baseline gap-3 sm:block">
                  <div className="font-mono text-sm text-amber-100">{update.version}</div>
                  <time
                    dateTime={update.date}
                    className="block text-xs text-muted-foreground sm:mt-1"
                  >
                    {update.date}
                  </time>
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 className="display-font text-xl leading-snug text-white transition group-hover:text-amber-100">
                      {update.title}
                    </h2>
                    <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      {update.type}
                    </span>
                  </div>
                  <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {update.summary}
                  </p>
                  {update.tags.length > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {update.tags.join(" · ")}
                    </p>
                  ) : null}
                </div>
              </Link>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  )
}
