import type { Metadata } from "next"
import { CalendarDays, Tag } from "lucide-react"

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
          Server news, event posts, tournament updates, rule changes, store policy notes, and community announcements.
        </p>
      </Reveal>

      <div className="mt-10 grid gap-5">
        {updates.map((update, index) => (
          <Reveal key={update.title} delay={index * 0.05}>
            <Card className="minecraft-card">
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
                <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
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
              </CardContent>
            </Card>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
