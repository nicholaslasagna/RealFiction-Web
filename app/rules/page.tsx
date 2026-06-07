import type { Metadata } from "next"
import { Search } from "lucide-react"

import { Reveal } from "@/components/reveal"
import { RulesExplorer } from "@/components/rules-explorer"

export const metadata: Metadata = {
  title: "Rules",
  description: "RealFiction community rules — respect, chat conduct, fair play, anti-cheat, gameplay, and account safety — all searchable."
}

export default function RulesPage() {
  return (
    <section className="container-shell py-14">
      <Reveal className="max-w-4xl">
        <h1 className="display-font text-5xl font-semibold leading-tight md:text-6xl">Rules</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
          The ground rules for RealFiction — respect, chat, fair play, gameplay, and account safety. Search to find a specific policy.
        </p>
        <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Search className="h-4 w-4 text-amber-200" />
          Searchable and ready for admin-managed rule updates.
        </div>
      </Reveal>
      <Reveal className="mt-10">
        <RulesExplorer />
      </Reveal>
    </section>
  )
}
