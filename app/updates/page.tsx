import type { Metadata } from "next"
import { CalendarDays, FileText, Tag } from "lucide-react"

import { Reveal } from "@/components/reveal"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { updates } from "@/lib/data"

export const metadata: Metadata = {
  title: "Updates",
  description: "RealFiction changelog, announcements, version tags, markdown-backed updates, and platform news."
}

export default function UpdatesPage() {
  return (
    <section className="container-shell py-14">
      <Reveal className="max-w-4xl">
        <Badge variant="default">
          <FileText className="mr-1.5 h-3.5 w-3.5" />
          Changelog
        </Badge>
        <h1 className="display-font mt-5 text-5xl font-semibold leading-tight md:text-6xl">Updates</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
          Admin-authored announcements, markdown release notes, network changelogs, version tags,
          tournament posts, and store policy updates.
        </p>
      </Reveal>

      <div className="mt-10 grid gap-5">
        {updates.map((update, index) => (
          <Reveal key={update.title} delay={index * 0.05}>
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <Badge variant="outline">{update.type}</Badge>
                    <CardTitle className="mt-3">{update.title}</CardTitle>
                    <CardDescription>{update.summary}</CardDescription>
                  </div>
                  <div className="rounded-md border border-border bg-background/50 px-3 py-2 font-mono text-sm text-primary">
                    {update.version}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    {update.date}
                  </span>
                  {update.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1.5">
                      <Tag className="h-4 w-4 text-primary" />
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
