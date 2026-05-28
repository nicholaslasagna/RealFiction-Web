import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, CalendarDays, Tag } from "lucide-react"

import { Reveal } from "@/components/reveal"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { updates } from "@/lib/data"

export const metadata: Metadata = {
  title: "Updates",
  description: "RealFiction news, announcements, event posts, changelogs, and store policy updates."
}

export default function UpdatesPage() {
  return (
    <section className="container-shell py-14">
      <Reveal className="max-w-4xl">
        <h1 className="display-font text-5xl font-semibold leading-tight md:text-6xl">Updates</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
          Server news, event posts, tournament updates, rule changes, store policy notes, and community
          announcements. Click any entry for the full patch notes.
        </p>
      </Reveal>

      <div className="mt-10 grid gap-5">
        {updates.map((update, index) => (
          <Reveal key={update.slug} delay={index * 0.05}>
            {/* Each card is now a link to the dedicated patch-notes page
                at /updates/[slug]. Hover shows a subtle "Read patch notes"
                affordance via the trailing arrow turning gold. */}
            <Link
              href={`/updates/${update.slug}`}
              className="group block"
              aria-label={`Read full patch notes: ${update.title}`}
            >
              <Card className="minecraft-card transition group-hover:border-amber-200/35">
                <CardHeader>
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <Badge variant="outline">{update.type}</Badge>
                      <CardTitle className="mt-3">{update.title}</CardTitle>
                      <CardDescription>{update.summary}</CardDescription>
                    </div>
                    <div className="rounded-md border border-amber-200/14 bg-black/24 px-3 py-2 font-mono text-sm text-amber-100">
                      {update.version}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
                    <div className="flex flex-wrap gap-3">
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays className="h-4 w-4 text-amber-200" />
                        {update.date}
                      </span>
                      {update.tags.map((tag) => (
                        <span key={tag} className="inline-flex items-center gap-1.5">
                          <Tag className="h-4 w-4 text-amber-200" />
                          {tag}
                        </span>
                      ))}
                    </div>
                    <span
                      className="inline-flex items-center gap-1.5 text-amber-200/90 transition group-hover:translate-x-1 group-hover:text-amber-100"
                      style={{ fontFamily: "rf-bold, sans-serif", textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 11 }}
                    >
                      Read patch notes
                      <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
