import type { Metadata } from "next"
import { Search, ShieldCheck } from "lucide-react"

import { Reveal } from "@/components/reveal"
import { RulesExplorer } from "@/components/rules-explorer"
import { Badge } from "@/components/ui/badge"

export const metadata: Metadata = {
  title: "Rules",
  description: "RealFiction rules with categories, search, fair play, factions, builds, purchases, and account safety."
}

export default function RulesPage() {
  return (
    <section className="container-shell py-14">
      <Reveal className="max-w-4xl">
        <Badge variant="success">
          <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
          Fair play first
        </Badge>
        <h1 className="display-font mt-5 text-5xl font-semibold leading-tight md:text-6xl">Rules</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
          Simple rules for chat, fair play, factions, builds, purchases, account safety, and moderation.
        </p>
        <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Search className="h-4 w-4 text-primary" />
          Searchable and ready for admin-managed rule updates.
        </div>
      </Reveal>
      <Reveal className="mt-10">
        <RulesExplorer />
      </Reveal>
    </section>
  )
}
